import type { BunWebSocketHandler } from "hono/bun";
import type { Hono } from "hono";
import type { LumoraEmailConfig, LumoraEmailService } from "./email";
import type { LumoraAIConfig, LumoraAIService } from "./ai";

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
  hidden?: boolean;
  readOnly?: boolean;
  unique?: boolean;
  indexed?: boolean;
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
  database: import("./db").LumoraDatabase;
}

export interface ResourceHooks<TFields extends ResourceFields = ResourceFields> {
  beforeCreate?(ctx: ResourceHookContext<TFields>): Promise<Record<string, unknown>> | Record<string, unknown>;
  afterCreate?(record: Record<string, unknown>): Promise<void> | void;
  beforeUpdate?(ctx: ResourceHookContext<TFields>): Promise<Record<string, unknown>> | Record<string, unknown>;
  afterUpdate?(record: Record<string, unknown>): Promise<void> | void;
  beforeDelete?(ctx: ResourceHookContext<TFields>): Promise<void> | void;
  afterDelete?(record: Record<string, unknown>): Promise<void> | void;
}

export type ResourceMethod = "GET_LIST" | "GET_ONE" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ResourcePermissionContext {
  method: ResourceMethod;
  auth: LumoraAuthResult | undefined;
  id?: string;
}

export type ResourcePermissionGuard = (
  ctx: ResourcePermissionContext
) => void | Promise<void>;

export type ResourcePermissions = Partial<
  Record<ResourceMethod, ResourcePermissionGuard>
> & {
  roles?: Partial<Record<ResourceMethod, string[]>>;
};

export interface AuditLogRecord {
  id: string;
  resource: string;
  action: "create" | "update" | "delete";
  record_id: string;
  actor_subject: string;
  actor_strategy: string;
  old_value: string;
  new_value: string;
  request_id: string;
  request_path: string;
  timestamp: string;
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
  permissions?: ResourcePermissions;
  audit?: boolean;
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
  email?: LumoraEmailConfig;
  ai?: LumoraAIConfig;
  logging?: {
    level?: "silent" | "minimal" | "verbose";
  };
  cors?: {
    origin?: string | string[];
    methods?: string[];
    headers?: string[];
    credentials?: boolean;
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
  logging: {
    level: "silent" | "minimal" | "verbose";
  };
  cors: {
    origin: string | string[];
    methods: string[];
    headers: string[];
    credentials: boolean;
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
  email?: LumoraEmailService;
  ai?: LumoraAIService;
  database: import("./db").LumoraDatabase;
  close(): Promise<void>;
}

export interface TypedEventEmitter<TMap extends object> {
  on<TKey extends keyof TMap>(event: TKey, listener: (payload: TMap[TKey]) => void): () => void;
  emit<TKey extends keyof TMap>(event: TKey, payload: TMap[TKey]): void;
}
