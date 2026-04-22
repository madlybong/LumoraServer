import type { BunWebSocketHandler } from "hono/bun";
import type { Hono } from "hono";

export type LumoraMode = "development" | "production" | "test";

export type FieldType = "string" | "number" | "boolean" | "json" | "datetime";

export interface ResourceField {
  type: FieldType;
  required?: boolean;
  description?: string;
  filterable?: boolean;
  sortable?: boolean;
  searchable?: boolean;
  default?: unknown;
}

export interface ResourceQueryOptions {
  filterable?: string[];
  sortable?: string[];
  searchable?: string[];
  defaultPageSize?: number;
  maxPageSize?: number;
}

export interface ResourceAuth {
  mode?: "inherit" | "public" | "protected";
}

export interface ResourceHookContext<TFields extends ResourceFields = ResourceFields> {
  input: Record<string, unknown>;
  id?: string;
  auth?: LumoraAuthResult;
  resource: ResourceSchema<TFields>;
}

export interface ResourceHooks<TFields extends ResourceFields = ResourceFields> {
  beforeCreate?(ctx: ResourceHookContext<TFields>): Promise<Record<string, unknown>> | Record<string, unknown>;
  afterCreate?(record: Record<string, unknown>): Promise<void> | void;
  beforeUpdate?(ctx: ResourceHookContext<TFields>): Promise<Record<string, unknown>> | Record<string, unknown>;
  afterUpdate?(record: Record<string, unknown>): Promise<void> | void;
  beforeDelete?(ctx: ResourceHookContext<TFields>): Promise<void> | void;
  afterDelete?(record: Record<string, unknown>): Promise<void> | void;
}

export interface ResourceMeta {
  title?: string;
  description?: string;
  group?: string;
  admin?: {
    hidden?: boolean;
    icon?: string;
  };
}

export type ResourceFields = Record<string, ResourceField>;

export interface ResourceSchema<TFields extends ResourceFields = ResourceFields> {
  resource: string;
  table?: string;
  fields: TFields;
  auth?: ResourceAuth;
  query?: ResourceQueryOptions;
  hooks?: ResourceHooks<TFields>;
  meta?: ResourceMeta;
}

export interface DefineResourceResult<TFields extends ResourceFields = ResourceFields> extends ResourceSchema<TFields> {
  kind: "resource";
}

export type LumoraAuthConfig =
  | { mode: "disabled" }
  | { mode: "static"; token: string; header?: string }
  | { mode: "jwt"; secret: string; issuer?: string; audience?: string };

export type LumoraDatabaseConfig =
  | { client: "sqlite"; url: string }
  | { client: "mysql"; url: string };

export interface LumoraConfig {
  name: string;
  mode: LumoraMode;
  server?: {
    port?: number;
  };
  api: {
    base: string;
    version: string;
  };
  auth: LumoraAuthConfig;
  database: LumoraDatabaseConfig;
  routes: {
    dir: string;
  };
  docs?: {
    enabled?: boolean;
    path?: string;
    openApiPath?: string;
  };
  realtime?: {
    sseSuffix?: string;
    websocketSuffix?: string;
  };
  admin?: {
    enabled?: boolean;
    path?: string;
  };
}

export interface ResolvedLumoraConfig extends LumoraConfig {
  rootDir: string;
  server: {
    port: number;
  };
  docs: {
    enabled: boolean;
    path: string;
    openApiPath: string;
  };
  realtime: {
    sseSuffix: string;
    websocketSuffix: string;
  };
}

export interface LumoraAuthResult {
  subject: string;
  strategy: "static" | "jwt";
  token: string;
  claims?: Record<string, unknown>;
}

export interface RequestAudit {
  requestId: string;
  path: string;
  method: string;
}

export interface ResourceEventPayload {
  resource: string;
  action: "created" | "updated" | "deleted" | "message";
  record?: Record<string, unknown>;
  message?: unknown;
  audit?: RequestAudit;
}

export interface TransactionEventPayload {
  resource: string;
  action: "create" | "update" | "delete";
  sql: string;
}

export interface LumoraEventMap {
  "lifecycle:init": { config: ResolvedLumoraConfig };
  "lifecycle:ready": { resources: string[] };
  "lifecycle:close": { name: string };
  "db:transaction:before": TransactionEventPayload;
  "db:transaction:after": TransactionEventPayload;
  "db:transaction:rollback": TransactionEventPayload & { error: string };
  "resource:create:before": ResourceEventPayload;
  "resource:create:after": ResourceEventPayload;
  "resource:update:before": ResourceEventPayload;
  "resource:update:after": ResourceEventPayload;
  "resource:delete:before": ResourceEventPayload;
  "resource:delete:after": ResourceEventPayload;
  "realtime:message": ResourceEventPayload;
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
  };
  paths: Record<string, Record<string, unknown>>;
}

export interface LumoraRealtime {
  publish(payload: ResourceEventPayload): void;
  subscribe(resource: string, listener: (payload: ResourceEventPayload) => void): () => void;
}

export interface LumoraInstance {
  app: Hono<any>;
  fetch: (request: Request, server?: Bun.Server<any>) => Response | Promise<Response>;
  websocket: BunWebSocketHandler<any>;
  config: ResolvedLumoraConfig;
  events: TypedEventEmitter<LumoraEventMap>;
  realtime: LumoraRealtime;
  docs: {
    openapi: OpenApiDocument;
    path: string;
    openApiPath: string;
  };
  close(): Promise<void>;
}

export interface TypedEventEmitter<TMap extends object> {
  on<TKey extends keyof TMap>(event: TKey, listener: (payload: TMap[TKey]) => void): () => void;
  emit<TKey extends keyof TMap>(event: TKey, payload: TMap[TKey]): void;
}
