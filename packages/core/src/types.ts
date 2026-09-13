import type { BunWebSocketHandler } from "hono/bun";
import type { Hono, Context } from "hono";
import type { LumoraEmailConfig, LumoraEmailService } from "./email";
import type { LumoraAIConfig, LumoraAIService, LumoraAIChatMessage, AIUsageSummary } from "./ai";

export type LumoraMode = "development" | "production" | "test";

export type FilterOperator =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
  | "in" | "nin" | "like" | "ilike" | "isnull" | "notnull";

export type FieldType = "string" | "number" | "boolean" | "json" | "datetime" | "file" | "file[]";

export interface FileFieldOptions {
  accept?: string[];       // e.g. ["image/*", ".pdf"]
  maxSize?: string;        // e.g. "10MB"
  maxCount?: number;       // max files for file[] fields
}

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
  visibleTo?: string[];
  fileOptions?: FileFieldOptions;  // only used when type is "file" or "file[]"
}

// LS-1: Computed / Virtual Fields
export interface ComputedFieldContext {
  auth?: LumoraAuthResult;
  database: import("./db").LumoraDatabase;
}

export interface ComputedFieldDef {
  type?: FieldType;
  description?: string;
  resolve: (record: Record<string, unknown>, ctx: ComputedFieldContext) => Promise<unknown> | unknown;
}

export type ComputedFields = Record<string, ComputedFieldDef>;

// LS-2: Relational Joins
export interface ResourceRelation {
  resource: string;             // name of the related resource
  foreignKey: string;           // for belongsTo: FK field on THIS resource; for hasMany: FK field on the RELATED resource
  type: "belongsTo" | "hasMany";
  matchOn?: string;             // field on the RELATED resource to match FK against (default: "id")
}

// LS-4: Bulk Operations
export interface BulkResult {
  success: boolean;
  id?: string;
  data?: Record<string, unknown>;
  error?: string;
}

// LS-5: CSV Export
export interface ResourceExportCsvOptions {
  columns?: string[];   // explicit column list; defaults to all non-hidden schema fields
  filename?: string;    // download filename; defaults to "{resource}-export.csv"
  /** Maximum rows to export. Defaults to 10_000. */
  maxRows?: number;
}

export type ResourceExportConfig = {
  csv?: boolean | ResourceExportCsvOptions;
};

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

// LS-9: Store-scoped permissions
export interface ResourceScope {
  /** The field on this resource (and in auth.scope) that carries the scope value. */
  field: string;
}

export interface ResourcePermissions {
  roles?: string[];
  allow?: (auth: LumoraAuthResult, method: ResourceMethod) => boolean | Promise<boolean>;
  allowRecord?: (auth: LumoraAuthResult, record: Record<string, unknown>) => boolean | Promise<boolean>;
  // LS-9: restrict list/read/write to records matching auth.scope[field]
  scope?: ResourceScope;
}

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

/**
 * Schema definition for a Lumora resource.
 * 
 * @example
 * ```typescript
 * import { defineResource } from "@astrake/lumora-server";
 * 
 * export default defineResource({
 *   resource: "users",
 *   fields: {
 *     name: { type: "string", required: true, searchable: true },
 *     email: { type: "string", required: true, unique: true },
 *     role: { type: "string", default: "user" },
 *     avatar: { type: "file", accept: ["image/*"] }
 *   },
 *   relations: {
 *     posts: { resource: "posts", foreignKey: "author_id", type: "hasMany" }
 *   },
 *   computed: {
 *     initials: { type: "string", resolve: (r) => r.name[0] }
 *   },
 *   audit: true,
 *   permissions: {
 *     scope: { field: "tenant_id" },
 *     roles: { "POST": ["admin"] }
 *   },
 *   rateLimit: { max: 10, windowMs: 60000 }
 * });
 * ```
 */
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
  readOnly?: boolean;
  immutable?: boolean;
  /** Per-resource rate limit override. Merges with global rateLimit config. */
  rateLimit?: {
    /** Override max requests per window for this resource. */
    max?: number;
    /** Override time window in ms for this resource. */
    windowMs?: number;
    /** Set true to completely bypass global rate limiting for this resource. */
    disabled?: boolean;
  };
  // LS-1: computed virtual fields (resolved on read, never stored)
  computed?: ComputedFields;
  // LS-2: relational joins (resolved via ?include= query param)
  relations?: Record<string, ResourceRelation>;
  // LS-4: bulk create operations
  bulk?: { transactional?: boolean };
  // LS-5: CSV export endpoint
  export?: ResourceExportConfig;
  updateMethod?: "put" | "patch" | "both";
}

export interface DefineResourceResult<TFields extends ResourceFields = ResourceFields> extends ResourceSchema<TFields> {
  kind: "resource";
}

/**
 * Configuration for authentication.
 * 
 * @example
 * ```typescript
 * auth: { 
 *   mode: "jwt", 
 *   secret: process.env.JWT_SECRET!,
 *   customClaims: { fields: ["tenant_id"] },
 *   afterVerify: async (auth, c) => {
 *     if (auth.claims?.tenant_id !== "expected") return c.text("Forbidden", 403);
 *   }
 * }
 * ```
 */
export type LumoraAuthConfig = {
  protectedPaths?: string[];
} & (
  | { mode: "disabled" }
  | { mode: "static"; token: string; header?: string }
  | {
      mode: "jwt";
      secret: string;
      issuer?: string;
      audience?: string;
      clockSkewSeconds?: number;
      /**
       * Declare additional JWT payload fields that your application embeds.
       * These fields already pass through in LumoraAuthResult.claims.
       * This declaration is for documentation and future tooling purposes.
       */
      customClaims?: {
        fields: string[];
      };
      /**
       * Called after Lumora successfully verifies a JWT. Receives the resolved
       * auth result and the Hono context. If this function returns a Response,
       * that response is returned to the client immediately (the request is aborted).
       * Returning void (or undefined) allows the request to proceed normally.
       */
      afterVerify?: (
        auth: import("./types").LumoraAuthResult,
        c: import("hono").Context
      ) => Promise<Response | void> | Response | void;
    }
);

/**
 * Configuration for database connections.
 * 
 * @example
 * ```typescript
 * // PostgreSQL with pooling and schema
 * database: {
 *   client: "postgresql",
 *   url: "postgres://user:pass@localhost:5432/db",
 *   schema: "public",
 *   pool: { min: 2, max: 10 }
 * }
 * 
 * // SQLite with auto-backup
 * database: {
 *   client: "sqlite",
 *   url: "./app.db",
 *   autoBackup: true
 * }
 * ```
 */
export type LumoraDatabaseConfig =
  | { client: "sqlite"; url: string; autoBackup?: boolean }
  | { client: "mysql"; url: string; autoBackup?: boolean }
  | {
      client: "postgresql";
      url: string;
      autoBackup?: boolean;
      pool?: { min?: number; max?: number; idleTimeout?: number };
      schema?: string;
      ssl?: boolean | { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean };
    };

// LS-8: Scheduled tasks (Bun.cron-based, no external deps)
export interface SchedulerContext {
  database: import("./db").LumoraDatabase;
  logger: import("./logger").LumoraLogger;
}

export interface LumoraScheduledTask {
  name: string;
  // Standard 5-field cron expression (e.g. "0/5 * * * *" for every 5 minutes)
  cron: string;
  log?: boolean;
  handler: (ctx: SchedulerContext) => Promise<void>;
  onError?: (err: unknown, ctx: SchedulerContext) => Promise<void> | void;
  /** Max retry attempts on handler failure (default: 0) */
  retries?: number;
  /** Delay between retries (e.g. "30s", "2m") — supports exponential backoff */
  retryDelay?: string;
  /** Whether this task is active (default: true) */
  enabled?: boolean;
}

/**
 * Configuration for the migration engine.
 * 
 * @example
 * ```typescript
 * migrations: {
 *   dir: "./migrations",
 *   mode: "auto",
 *   blockDestructive: true,
 *   embeddedFiles: {} // used for SFE
 * }
 * ```
 */
export interface LumoraMigrationsConfig {
  /**
   * Directory containing *.sql migration files.
   * Relative to lumora.config.ts location. Default: "migrations"
   */
  dir?: string;
  /**
   * "auto"   — apply pending migrations automatically on startup (default in development)
   * "strict" — fail startup if any pending migration exists (default in production)
   * "off"    — disable migration engine entirely (default in test)
   */
  mode?: "auto" | "strict" | "off";
  allowDowngrade?: boolean;
  blockDestructive?: boolean;
  /**
   * Statically embedded SQL files (key: filename, value: SQL content).
   * Used for Single File Executable (SFE) deployments.
   */
  embeddedFiles?: Record<string, string>;
}

/**
 * Configuration schema for the Lumora Server.
 * 
 * @example
 * ```typescript
 * import { defineLumoraConfig } from "@astrake/lumora-server";
 * 
 * export default defineLumoraConfig({
 *   name: "my-app",
 *   mode: "development",
 *   api: { base: "/api", version: "v1" },
 *   database: { client: "postgresql", url: process.env.PG_URL! },
 *   auth: { mode: "jwt", secret: process.env.JWT_SECRET! },
 *   routes: { dir: "./routes" },
 *   migrations: { dir: "./migrations" },
 *   realtime: { enabled: true },
 *   rateLimit: { enabled: true, max: 100, windowMs: 60000, store: "memory" },
 *   schedule: [
 *     { name: "sync", cron: "0 8 * * *", handler: async (ctx) => {} }
 *   ]
 * });
 * ```
 */
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
  routes?: {
    dir: string;
  };
  // Inline resources for programmatic usage or testing (bypasses file-based route loading)
  resources?: DefineResourceResult[];
  docs?: {
    enabled?: boolean;
    path?: string;
    openApiPath?: string;
  };
  realtime?: {
    enabled?: boolean;
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
    allowHeaders?: string[];
    allowMethods?: string[];
    exposeHeaders?: string[];
    maxAge?: number;
    passthrough?: boolean;
  };
  multiTenancy?: {
    enabled?: boolean;
    tenantIdField?: string;
  };
  // LS-3: file upload configuration
  upload?: {
    dir: string;          // local directory to write uploaded files
    serveAt?: string;     // URL prefix to serve files (default: /__lumora/uploads)
  };
  // LS-8: declarative scheduled tasks
  schedule?: LumoraScheduledTask[];
  // Migration system config
  migrations?: LumoraMigrationsConfig;
  rateLimit?: {
    enabled?: boolean;
    windowMs?: number;
    max?: number;
    store?: "memory" | "database";
  };
}

export interface ResolvedLumoraConfig extends Omit<LumoraConfig, "database"> {
  rootDir: string;
  database: LumoraDatabaseConfig & { autoBackup: boolean };
  server: {
    port: number;
  };
  docs: {
    enabled: boolean;
    path: string;
    openApiPath: string;
  };
  realtime: {
    enabled: boolean;
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
    exposeHeaders?: string[];
    maxAge?: number;
    passthrough?: boolean;
  };
  multiTenancy?: {
    enabled: boolean;
    tenantIdField: string;
  };
  migrations: {
    /** Absolute resolved path to migrations directory */
    dir: string;
    mode: "auto" | "strict" | "off";
    allowDowngrade?: boolean;
    blockDestructive?: boolean;
    embeddedFiles?: Record<string, string>;
  };
  rateLimit: {
    enabled: boolean;
    windowMs: number;
    max: number;
    store: "memory" | "database";
  };
}

export interface LumoraAuthResult {
  subject: string;
  strategy: "jwt" | "static" | "custom";
  token: string;
  claims?: Record<string, unknown>;
  roles?: string[];
  // LS-9: scope values extracted from JWT claims (e.g. { store_id: "store-kolkata" })
  scope?: Record<string, unknown>;
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
  "db:transaction:rollback": TransactionEventPayload & { error?: string };
  "resource:create:before": ResourceEventPayload;
  "resource:create:after": ResourceEventPayload;
  "resource:update:before": ResourceEventPayload;
  "resource:update:after": ResourceEventPayload;
  "resource:delete:before": ResourceEventPayload;
  "resource:delete:after": ResourceEventPayload;
  "realtime:message": ResourceEventPayload;
  // LS-6: per-resource namespaced events (resource:{name}:afterCreate etc.)
  [key: `resource:${string}:afterCreate`]: ResourceEventPayload;
  [key: `resource:${string}:afterUpdate`]: ResourceEventPayload;
  [key: `resource:${string}:afterDelete`]: ResourceEventPayload;
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
  };
  paths: Record<string, Record<string, unknown>>;
}

export type SseAuthOptions =
  | { mode: "bearer-header" }
  | { mode: "query-token"; secret?: string }
  | { mode: "none" };

export interface LumoraRealtime {
  publish(payload: ResourceEventPayload): void;
  subscribe(resource: string, listener: (payload: ResourceEventPayload) => void): () => void;
  // LS-7: broadcast a custom event to all connected clients on a topic
  broadcast(topic: string, data: unknown): void;
  createSseResponse(resource: string, c?: Context, options?: SseAuthOptions): Response | Promise<Response>;
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
  // LS-8: scheduler handle for graceful shutdown
  scheduler?: { stop: () => void };
  // LS-11: structured query executor
  query: import("./query").QueryExecutor;
  /** All loaded resource definitions (inline or file-based). */
  resources: DefineResourceResult[];
  readonly apiPrefix: string;
  mountModule(path: string, router: Hono<any>, options?: { protected?: boolean }): this;
  shutdown(): Promise<void>;
  onShutdown(callback: () => Promise<void> | void): void;
  close(): Promise<void>;
}

export interface AuditLogOpts {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  /** State of record BEFORE the change. Written to old_value in audit log. */
  before?: Record<string, unknown>;
  /** State of record AFTER the change. Written to new_value in audit log. */
  after?: Record<string, unknown>;
  /** Strategy label written to actor_strategy. Defaults to "procedural". */
  actorStrategy?: "jwt" | "static" | "procedural" | (string & {});
  /** @deprecated Use before/after instead. Still accepted for backwards compat — both old_value and new_value will be set to this. */
  details?: Record<string, unknown>;
}

export interface LumoraModuleContext {
  db: import("./db").LumoraDatabase;
  auth: LumoraAuthConfig;
  ai?: LumoraAIService;
  realtime?: LumoraRealtime;
  logAudit: (opts: AuditLogOpts, options?: { strict?: boolean }) => Promise<void> | void;
}

export type LumoraHonoVariables = {
  user: Record<string, unknown>;
  userRole: string;
  requestId: string;
  lumoraJson: <T>(data: T, status?: number) => Response;
  lumoraError: (message: string, status?: number) => Response;
};

export interface TypedEventEmitter<TMap extends object> {
  on<TKey extends keyof TMap>(event: TKey, listener: (payload: TMap[TKey]) => void): () => void;
  emit<TKey extends keyof TMap>(event: TKey, payload: TMap[TKey]): void;
}

export class LumoraDuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LumoraDuplicateError";
  }
}
