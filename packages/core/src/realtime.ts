import { verifyJwtToken } from "./auth";
import type { ResourceEventPayload, LumoraRealtime, SseAuthOptions } from "./types";
import type { Context } from "hono";

interface SseClient {
  controller: ReadableStreamDefaultController<string>;
  tenantId?: string;
  scope?: { field: string; value: unknown };
  heartbeatTimer?: ReturnType<typeof setInterval>;
}

interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface SocketMeta {
  tenantId?: string;
  scope?: { field: string; value: unknown };
}

interface ReplayEntry {
  id: number;
  encoded: string;
  tenantId?: string;
  record?: Record<string, unknown>;
}

export interface RealtimeHubOptions {
  heartbeatIntervalMs?: number;
  maxReplayBuffer?: number;
}

function matchesClientFilter(
  clientMeta: { tenantId?: string; scope?: { field: string; value: unknown } },
  eventTenantId?: string,
  record?: Record<string, unknown>
): boolean {
  if (eventTenantId !== undefined && clientMeta.tenantId !== undefined && clientMeta.tenantId !== eventTenantId) {
    return false;
  }
  if (eventTenantId !== undefined && clientMeta.tenantId === undefined) {
    return false;
  }
  if (clientMeta.scope && record && clientMeta.scope.field in record) {
    if (record[clientMeta.scope.field] !== clientMeta.scope.value) {
      return false;
    }
  }
  return true;
}

export class LumoraRealtimeHub implements LumoraRealtime {
  private readonly listeners = new Map<string, Set<(payload: ResourceEventPayload) => void>>();
  private readonly sseClients = new Map<string, Set<SseClient>>();
  private readonly sockets = new Map<string, Set<SocketLike>>();
  private readonly socketMeta = new WeakMap<SocketLike, SocketMeta>();
  private readonly replayBuffers = new Map<string, ReplayEntry[]>();
  private eventSeq = 0;
  private readonly heartbeatIntervalMs: number;
  private readonly maxReplayBuffer: number;

  constructor(
    private readonly authSecret?: string,
    options?: RealtimeHubOptions
  ) {
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 25_000;
    this.maxReplayBuffer = options?.maxReplayBuffer ?? 100;
  }

  private recordReplay(channel: string, entry: ReplayEntry): void {
    if (this.maxReplayBuffer <= 0) return;
    const buf = this.replayBuffers.get(channel) ?? [];
    buf.push(entry);
    if (buf.length > this.maxReplayBuffer) {
      buf.shift();
    }
    this.replayBuffers.set(channel, buf);
  }

  publish(payload: ResourceEventPayload): void {
    const resourceListeners = this.listeners.get(payload.resource) ?? new Set();
    for (const listener of resourceListeners) {
      listener(payload);
    }

    const seq = ++this.eventSeq;
    const encoded = `id: ${seq}\nevent: ${payload.action}\ndata: ${JSON.stringify(payload)}\n\n`;
    this.recordReplay(payload.resource, {
      id: seq,
      encoded,
      tenantId: payload.tenantId,
      record: payload.record
    });

    for (const client of this.sseClients.get(payload.resource) ?? new Set()) {
      if (matchesClientFilter(client, payload.tenantId, payload.record)) {
        try {
          client.controller.enqueue(encoded);
        } catch {
          this.removeSseClient(payload.resource, client);
        }
      }
    }

    const message = JSON.stringify({ id: seq, type: payload.action, payload });
    for (const socket of this.sockets.get(payload.resource) ?? new Set()) {
      const meta = this.socketMeta.get(socket) ?? {};
      if (matchesClientFilter(meta, payload.tenantId, payload.record)) {
        socket.send(message);
      }
    }
  }

  // LS-7: broadcast a custom event to all clients on a specific topic (non-CRUD)
  broadcast(topic: string, data: unknown): void {
    const seq = ++this.eventSeq;
    const encoded = `id: ${seq}\nevent: message\ndata: ${JSON.stringify({ topic, data })}\n\n`;
    const message = JSON.stringify({ id: seq, type: "message", topic, data });
    this.recordReplay(topic, { id: seq, encoded });

    for (const client of this.sseClients.get(topic) ?? new Set()) {
      try {
        client.controller.enqueue(encoded);
      } catch {
        this.removeSseClient(topic, client);
      }
    }
    for (const socket of this.sockets.get(topic) ?? new Set()) {
      socket.send(message);
    }
    for (const client of this.sseClients.get("*") ?? new Set()) {
      try {
        client.controller.enqueue(encoded);
      } catch {
        this.removeSseClient("*", client);
      }
    }
    for (const socket of this.sockets.get("*") ?? new Set()) {
      socket.send(message);
    }
  }

  // RFC-06: Broadcast an event strictly isolated to a specific tenant's channel
  publishToTenant(tenantId: string, topic: string, data: unknown): void {
    const seq = ++this.eventSeq;
    const channel = `tenant:${tenantId}:${topic}`;
    const wildcardChannel = `tenant:${tenantId}:*`;
    const encoded = `id: ${seq}\nevent: ${topic}\ndata: ${JSON.stringify({ tenantId, topic, data })}\n\n`;
    const message = JSON.stringify({ id: seq, type: "message", tenantId, topic, data });

    this.recordReplay(channel, { id: seq, encoded, tenantId });
    this.recordReplay(topic, { id: seq, encoded, tenantId });

    // 1. Dedicated tenant channel subscribers
    for (const ch of [channel, wildcardChannel]) {
      for (const client of this.sseClients.get(ch) ?? new Set()) {
        try {
          client.controller.enqueue(encoded);
        } catch {
          this.removeSseClient(ch, client);
        }
      }
      for (const socket of this.sockets.get(ch) ?? new Set()) {
        socket.send(message);
      }
    }

    // 2. Topic or wildcard subscribers that match this tenantId
    for (const ch of [topic, "*"]) {
      for (const client of this.sseClients.get(ch) ?? new Set()) {
        if (client.tenantId === tenantId) {
          try {
            client.controller.enqueue(encoded);
          } catch {
            this.removeSseClient(ch, client);
          }
        }
      }
      for (const socket of this.sockets.get(ch) ?? new Set()) {
        const meta = this.socketMeta.get(socket);
        if (meta?.tenantId === tenantId) {
          socket.send(message);
        }
      }
    }
  }

  subscribe(resource: string, listener: (payload: ResourceEventPayload) => void): () => void {
    const set = this.listeners.get(resource) ?? new Set<(payload: ResourceEventPayload) => void>();
    set.add(listener);
    this.listeners.set(resource, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(resource);
      }
    };
  }

  async createTenantSseResponse(
    tenantId: string,
    topic: string,
    c?: Context,
    options?: SseAuthOptions
  ): Promise<Response> {
    return this.createSseResponse(`tenant:${tenantId}:${topic}`, c, {
      mode: options?.mode ?? "none",
      ...options,
      tenantId
    });
  }

  async createSseResponse(resource: string, c?: Context, options?: SseAuthOptions): Promise<Response> {
    const authOpts = options ?? { mode: "none" };
    let resolvedTenantId = authOpts.tenantId;

    if (authOpts.mode === "query-token") {
      if (!c) throw new Error("Context required for query-token SSE auth");
      const token = c.req.query("token");
      if (!token) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const secret = authOpts.secret ?? this.authSecret;
      if (!secret) {
        return Response.json({ error: "No JWT secret configured" }, { status: 503 });
      }
      try {
        const claims = await verifyJwtToken(token, secret);
        if (!resolvedTenantId) {
          const jwtTenant = claims.tenantId ?? claims.companyId;
          if (typeof jwtTenant === "string") {
            resolvedTenantId = jwtTenant;
          }
        }
      } catch {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const lastEventIdHeader = c?.req.header("Last-Event-ID") ?? c?.req.query("lastEventId");
    const lastEventId = lastEventIdHeader ? Number(lastEventIdHeader) : NaN;

    const client: Partial<SseClient> = {
      tenantId: resolvedTenantId,
      scope: authOpts.scope
    };

    const stream = new ReadableStream<string>({
      start: (controller) => {
        client.controller = controller;
        const fullClient = client as SseClient;
        const set = this.sseClients.get(resource) ?? new Set<SseClient>();
        set.add(fullClient);
        this.sseClients.set(resource, set);

        controller.enqueue(`event: ready\ndata: ${JSON.stringify({ resource, tenantId: resolvedTenantId })}\n\n`);

        // RFC-06: Replay missed events if Last-Event-ID was provided
        if (!Number.isNaN(lastEventId)) {
          const buffer = this.replayBuffers.get(resource) ?? [];
          for (const entry of buffer) {
            if (entry.id > lastEventId && matchesClientFilter(fullClient, entry.tenantId, entry.record)) {
              controller.enqueue(entry.encoded);
            }
          }
        }

        // RFC-06: Periodic keep-alive SSE comment frame (: ping\n\n)
        if (this.heartbeatIntervalMs > 0) {
          fullClient.heartbeatTimer = setInterval(() => {
            try {
              controller.enqueue(": ping\n\n");
            } catch {
              this.removeSseClient(resource, fullClient);
            }
          }, this.heartbeatIntervalMs);
          if (typeof fullClient.heartbeatTimer.unref === "function") {
            fullClient.heartbeatTimer.unref();
          }
        }
      },
      cancel: () => {
        this.removeSseClient(resource, client as SseClient);
      }
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      }
    });
  }

  attachSocket(resource: string, socket: SocketLike, meta?: SocketMeta): void {
    const set = this.sockets.get(resource) ?? new Set<SocketLike>();
    set.add(socket);
    this.sockets.set(resource, set);
    if (meta) {
      this.socketMeta.set(socket, meta);
    }
  }

  detachSocket(resource: string, socket: SocketLike): void {
    const set = this.sockets.get(resource);
    if (!set) {
      return;
    }
    set.delete(socket);
    if (set.size === 0) {
      this.sockets.delete(resource);
    }
  }

  close(): void {
    for (const [resource, set] of this.sseClients.entries()) {
      for (const client of set) {
        if (client.heartbeatTimer) {
          clearInterval(client.heartbeatTimer);
        }
        try {
          client.controller.close();
        } catch {
          // Ignore already closed stream
        }
      }
      this.sseClients.delete(resource);
    }

    for (const [resource, set] of this.sockets.entries()) {
      for (const socket of set) {
        try {
          socket.close(1001, "Server shutting down");
        } catch {
          // Ignore already closed socket
        }
      }
      this.sockets.delete(resource);
    }

    this.listeners.clear();
  }

  private removeSseClient(resource: string, client: SseClient): void {
    if (client.heartbeatTimer) {
      clearInterval(client.heartbeatTimer);
      client.heartbeatTimer = undefined;
    }
    const set = this.sseClients.get(resource);
    if (!set) {
      return;
    }
    set.delete(client);
    if (set.size === 0) {
      this.sseClients.delete(resource);
    }
  }
}
