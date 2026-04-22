import type { ResourceEventPayload, LumoraRealtime } from "./types";

interface SseClient {
  controller: ReadableStreamDefaultController<string>;
}

interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export class LumoraRealtimeHub implements LumoraRealtime {
  private readonly listeners = new Map<string, Set<(payload: ResourceEventPayload) => void>>();
  private readonly sseClients = new Map<string, Set<SseClient>>();
  private readonly sockets = new Map<string, Set<SocketLike>>();

  publish(payload: ResourceEventPayload): void {
    const resourceListeners = this.listeners.get(payload.resource) ?? new Set();
    for (const listener of resourceListeners) {
      listener(payload);
    }

    const encoded = `event: ${payload.action}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.sseClients.get(payload.resource) ?? new Set()) {
      client.controller.enqueue(encoded);
    }

    const message = JSON.stringify({ type: payload.action, payload });
    for (const socket of this.sockets.get(payload.resource) ?? new Set()) {
      socket.send(message);
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

  createSseResponse(resource: string): Response {
    const client: Partial<SseClient> = {};
    const stream = new ReadableStream<string>({
      start: (controller) => {
        client.controller = controller;
        const set = this.sseClients.get(resource) ?? new Set<SseClient>();
        set.add(client as SseClient);
        this.sseClients.set(resource, set);
        controller.enqueue(`event: ready\ndata: ${JSON.stringify({ resource })}\n\n`);
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

  attachSocket(resource: string, socket: SocketLike): void {
    const set = this.sockets.get(resource) ?? new Set<SocketLike>();
    set.add(socket);
    this.sockets.set(resource, set);
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

  private removeSseClient(resource: string, client: SseClient): void {
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
