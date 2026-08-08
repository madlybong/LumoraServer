import { SQL } from "bun";
import type {
  DefineResourceResult,
  LumoraDatabaseConfig,
  LumoraEventMap,
  RequestAudit,
  ResourceEventPayload,
  ResourceField,
  TransactionEventPayload,
  TypedEventEmitter,
  AuditLogRecord,
  BulkResult
} from "./types";

export interface MigrationRecord {
  id: number;
  name: string;       // filename stem, e.g. "20260524_001_create_company"
  checksum: string;   // SHA-256 hex of file content
  applied_at: string; // ISO timestamp
}

interface ListOptions {
  filters: URLSearchParams;
  search?: string;
  sort?: string;
  page: number;
  pageSize: number;
  // LS-9: scope injection — adds a non-bypassable WHERE clause for store-scoped resources
  scope?: { field: string; value: unknown };
}

type DbClient = LumoraDatabaseConfig["client"];

function quoteIdentifier(client: DbClient, identifier: string): string {
  const safe = identifier.replace(/[`"]/g, "");
  return client === "postgresql" ? `"${safe}"` : `\`${safe}\``;
}

function sqlTextType(client: DbClient, field: ResourceField): string {
  if (client === "postgresql") {
    switch (field.type) {
      case "number":   return "NUMERIC";
      case "boolean":  return "BOOLEAN";
      case "json":     return "JSONB";
      case "datetime": return "TIMESTAMPTZ";
      case "file":
      case "file[]":   return "TEXT";
      default:         return "TEXT";
    }
  }
  switch (field.type) {
    case "number":
      return client === "mysql" ? "DOUBLE" : "REAL";
    case "boolean":
      return client === "mysql" ? "BOOLEAN" : "INTEGER";
    case "json":
      return client === "mysql" ? "JSON" : "TEXT";
    case "datetime":
      return client === "mysql" ? "DATETIME" : "TEXT";
    case "file":
    case "file[]":
      return "TEXT"; // stored as URL string
    case "string":
    default:
      return "TEXT";
  }
}

function escapeValue(client: DbClient, value: unknown, field?: ResourceField): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (field?.type === "json") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  if (field?.type === "boolean") {
    return client === "postgresql" ? (value ? "TRUE" : "FALSE") : (value ? "1" : "0");
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeRecord(record: Record<string, unknown>, resource: DefineResourceResult): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    id: record.id,
    createdAt: record.created_at ?? record.createdAt,
    updatedAt: record.updated_at ?? record.updatedAt
  };

  for (const [fieldName, field] of Object.entries(resource.fields)) {
    if (field.hidden) continue;
    const raw = record[fieldName];
    if (field.type === "boolean") {
      normalized[fieldName] = raw === true || raw === 1 || raw === "1";
    } else if (field.type === "number") {
      normalized[fieldName] = raw === null || raw === undefined ? raw : Number(raw);
    } else if (field.type === "json") {
      if (typeof raw === "string") {
        try {
          normalized[fieldName] = JSON.parse(raw);
        } catch {
          normalized[fieldName] = raw;
        }
      } else {
        normalized[fieldName] = raw; // already parsed (PostgreSQL JSONB native)
      }
    } else if (field.type === "file" || field.type === "file[]") {
      // Pass through as-is — stored as URL string(s)
      normalized[fieldName] = raw;
    } else {
      normalized[fieldName] = raw;
    }
  }

  return normalized;
}

function buildWhereClause(client: DbClient, resource: DefineResourceResult, filters: URLSearchParams, searchTerm?: string): string[] {
  const reservedParams = new Set(["page", "pageSize", "limit", "sort", "search", "include"]);
  const filterable = new Set(resource.query?.filterable ?? Object.keys(resource.fields).filter((key) => resource.fields[key]!.filterable));
  const clauses: string[] = [];

  const OPERATOR_RE = /^(.+?)__(gt|gte|lt|lte|neq|in|nin|like|isnull|notnull)$/;

  for (const [rawKey, value] of filters.entries()) {
    if (reservedParams.has(rawKey)) continue;

    const match = rawKey.match(OPERATOR_RE);
    const fieldName = match ? match[1]! : rawKey;
    const operator  = match ? match[2]! : "eq";

    if (!filterable.has(fieldName)) continue;

    const col   = quoteIdentifier(client, fieldName);
    const field = resource.fields[fieldName];

    switch (operator) {
      case "gt":      clauses.push(`${col} > ${escapeValue(client, value, field)}`); break;
      case "gte":     clauses.push(`${col} >= ${escapeValue(client, value, field)}`); break;
      case "lt":      clauses.push(`${col} < ${escapeValue(client, value, field)}`); break;
      case "lte":     clauses.push(`${col} <= ${escapeValue(client, value, field)}`); break;
      case "neq":     clauses.push(`${col} != ${escapeValue(client, value, field)}`); break;
      case "like":    clauses.push(`${col} LIKE ${escapeValue(client, value)}`);      break;
      case "isnull":  clauses.push(`${col} IS NULL`);                                 break;
      case "notnull": clauses.push(`${col} IS NOT NULL`);                             break;
      case "in": {
        const vals = value.split(",").map(v => escapeValue(client, v.trim(), field)).join(", ");
        clauses.push(`${col} IN (${vals})`);
        break;
      }
      case "nin": {
        const vals = value.split(",").map(v => escapeValue(client, v.trim(), field)).join(", ");
        clauses.push(`${col} NOT IN (${vals})`);
        break;
      }
      default: clauses.push(`${col} = ${escapeValue(client, value, field)}`); break;
    }
  }

  if (searchTerm) {
    const searchable = Object.keys(resource.fields).filter((k) => resource.fields[k]!.searchable);
    if (searchable.length > 0) {
      const like = searchable
        .map((k) => `${quoteIdentifier(client, k)} LIKE ${escapeValue(client, `%${searchTerm}%`)}`)
        .join(" OR ");
      clauses.push(`(${like})`);
    }
  }

  return clauses;
}

function buildSortClause(client: DbClient, resource: DefineResourceResult, sort?: string): string {
  if (!sort) {
    return "ORDER BY updated_at DESC";
  }

  const descending = sort.startsWith("-");
  const field = descending ? sort.slice(1) : sort;
  const sortable = new Set(resource.query?.sortable ?? Object.keys(resource.fields).filter((key) => resource.fields[key]!.sortable));

  if (!sortable.has(field)) {
    return "ORDER BY updated_at DESC";
  }

  return `ORDER BY ${quoteIdentifier(client, field)} ${descending ? "DESC" : "ASC"}`;
}

function buildTransactionPayload(resource: DefineResourceResult, action: TransactionEventPayload["action"], sql: string): TransactionEventPayload {
  return {
    resource: resource.resource,
    action,
    sql
  };
}

function buildSelectClause(client: DbClient, resource: DefineResourceResult): string {
  const fields = ["id", "created_at", "updated_at", ...Object.keys(resource.fields)];
  return fields.map(f => quoteIdentifier(client, f)).join(", ");
}

export class LumoraDatabase {
  readonly sql: SQL;
  tenantId?: string;

  constructor(
    public readonly config: LumoraDatabaseConfig,
    private readonly events: TypedEventEmitter<LumoraEventMap>,
    public readonly multiTenancy?: { enabled: boolean; tenantIdField: string }
  ) {
    if (config.client === "postgresql") {
      const pgSchema = config.schema && config.schema !== "public" ? config.schema : undefined;
      this.sql = new SQL(config.url, {
        max:         config.pool?.max ?? 10,
        idleTimeout: config.pool?.idleTimeout ?? 30_000,
        ssl:         config.ssl ?? false,
        // Use PostgreSQL startup parameters to set search_path per connection.
        // This is the correct mechanism — no extra per-connection query needed.
        ...(pgSchema ? { connection: { search_path: pgSchema } } : {}),
      });
    } else {
      this.sql = new SQL(config.url, config.client === "mysql" ? { adapter: "mysql" } : { adapter: "sqlite" });
    }
  }

  async connect(): Promise<void> {
    await this.sql.connect();
  }

  async close(): Promise<void> {
    await this.sql.close();
  }

  scoped(tenantId: string): LumoraDatabase {
    const clone = Object.create(this) as LumoraDatabase;
    clone.tenantId = tenantId;
    return clone;
  }

  async ensureResource(resource: DefineResourceResult): Promise<void> {
    const tableName = resource.table ?? resource.resource;
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = schemaPrefix + quoteIdentifier(this.config.client, tableName);
    
    const fieldLines = Object.entries(resource.fields).map(([name, field]) => {
      const suffix = field.required ? " NOT NULL" : "";
      return `${quoteIdentifier(this.config.client, name)} ${sqlTextType(this.config.client, field)}${suffix}`;
    });
    
    let ddl: string;
    if (this.config.client === "postgresql") {
      ddl = [
        `CREATE TABLE IF NOT EXISTS ${table} (`,
        `${quoteIdentifier(this.config.client, "id")} TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,`,
        ...fieldLines.map((line) => `${line},`),
        `${quoteIdentifier(this.config.client, "created_at")} TIMESTAMPTZ NOT NULL DEFAULT NOW(),`,
        `${quoteIdentifier(this.config.client, "updated_at")} TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
        ")"
      ].join(" ");
    } else {
      ddl = [
        `CREATE TABLE IF NOT EXISTS ${table} (`,
        `${quoteIdentifier(this.config.client, "id")} VARCHAR(191) PRIMARY KEY,`,
        ...fieldLines.map((line) => `${line},`),
        `${quoteIdentifier(this.config.client, "created_at")} TEXT NOT NULL,`,
        `${quoteIdentifier(this.config.client, "updated_at")} TEXT NOT NULL`,
        ")"
      ].join(" ");
    }
    await this.sql.unsafe(ddl);

    for (const [name, field] of Object.entries(resource.fields)) {
      if (field.unique) {
        await this.sql.unsafe(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(this.config.client, `idx_${tableName}_${name}_unique`)} ON ${table} (${quoteIdentifier(this.config.client, name)})`
        );
      } else if (field.indexed) {
        await this.sql.unsafe(
          `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(this.config.client, `idx_${tableName}_${name}`)} ON ${table} (${quoteIdentifier(this.config.client, name)})`
        );
      }
    }
  }

  async list(resource: DefineResourceResult, options: ListOptions): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = schemaPrefix + quoteIdentifier(this.config.client, resource.table ?? resource.resource);
    const where = buildWhereClause(this.config.client, resource, options.filters, options.search);
    // LS-9: inject scope as a non-bypassable WHERE condition (cannot be overridden by user filters)
    if (options.scope) {
      where.push(`${quoteIdentifier(this.config.client, options.scope.field)} = ${escapeValue(this.config.client, options.scope.value)}`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const sort = buildSortClause(this.config.client, resource, options.sort);
    const offset = (options.page - 1) * options.pageSize;
    const dataQuery = `SELECT * FROM ${table} ${clause} ${sort} LIMIT ${options.pageSize} OFFSET ${offset}`;
    const countQuery = `SELECT COUNT(*) as total FROM ${table} ${clause}`;
    const [rows, countRows] = await Promise.all([
      this.sql.unsafe<Record<string, unknown>[]>(dataQuery),
      this.sql.unsafe<Record<string, unknown>[]>(countQuery)
    ]);
    return {
      items: rows.map((row) => normalizeRecord(row, resource)),
      total: Number((countRows[0] as any)?.total ?? 0),
      page: options.page,
      pageSize: options.pageSize
    };
  }


  async get(resource: DefineResourceResult, id: string): Promise<Record<string, unknown> | null> {
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = schemaPrefix + quoteIdentifier(this.config.client, resource.table ?? resource.resource);
    const tenantClause = (this.multiTenancy?.enabled && this.tenantId)
      ? ` AND ${quoteIdentifier(this.config.client, this.multiTenancy.tenantIdField ?? "tenant_id")} = ${escapeValue(this.config.client, this.tenantId)}`
      : "";
    const select = buildSelectClause(this.config.client, resource);
    const query = `SELECT ${select} FROM ${table} WHERE id = ${escapeValue(this.config.client, id)}${tenantClause} LIMIT 1`;
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(query);
    return rows[0] ? normalizeRecord(rows[0], resource) : null;
  }

  async create(
    resource: DefineResourceResult,
    input: Record<string, unknown>,
    audit?: RequestAudit
  ): Promise<Record<string, unknown>> {
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = schemaPrefix + quoteIdentifier(this.config.client, resource.table ?? resource.resource);

    if (this.multiTenancy?.enabled && this.tenantId) {
      input = { ...input, [this.multiTenancy.tenantIdField ?? "tenant_id"]: this.tenantId };
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const record = {
      id,
      ...input,
      created_at: now,
      updated_at: now
    };
    const columns = Object.keys(record).map(k => quoteIdentifier(this.config.client, k)).join(", ");
    const values = Object.entries(record)
      .map(([key, value]) => escapeValue(this.config.client, value, key in resource.fields ? resource.fields[key] : undefined))
      .join(", ");
    const query = `INSERT INTO ${table} (${columns}) VALUES (${values})`;
    const tx = buildTransactionPayload(resource, "create", query);
    this.events.emit("db:transaction:before", tx);

    try {
      await this.sql.begin(async (sql) => {
        await sql.unsafe(query);
      });
      this.events.emit("db:transaction:after", tx);
      return normalizeRecord(record, resource);
    } catch (error) {
      this.events.emit("db:transaction:rollback", { ...tx, error: String(error) });
      throw error;
    }
  }

  async update(
    resource: DefineResourceResult,
    id: string,
    input: Record<string, unknown>,
    audit?: RequestAudit
  ): Promise<Record<string, unknown> | null> {
    const existing = await this.get(resource, id);
    if (!existing) {
      return null;
    }

    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = schemaPrefix + quoteIdentifier(this.config.client, resource.table ?? resource.resource);
    const updatedAt = new Date().toISOString();
    const assignments = Object.entries(input)
      .map(([key, value]) => `${quoteIdentifier(this.config.client, key)} = ${escapeValue(this.config.client, value, resource.fields[key])}`)
      .concat(`${quoteIdentifier(this.config.client, "updated_at")} = ${escapeValue(this.config.client, updatedAt)}`)
      .join(", ");
    
    const tenantClause = (this.multiTenancy?.enabled && this.tenantId)
      ? ` AND ${quoteIdentifier(this.config.client, this.multiTenancy.tenantIdField ?? "tenant_id")} = ${escapeValue(this.config.client, this.tenantId)}`
      : "";

    const query = `UPDATE ${table} SET ${assignments} WHERE id = ${escapeValue(this.config.client, id)}${tenantClause}`;
    const tx = buildTransactionPayload(resource, "update", query);
    this.events.emit("db:transaction:before", tx);

    try {
      await this.sql.begin(async (sql) => {
        await sql.unsafe(query);
      });
      this.events.emit("db:transaction:after", tx);
      return {
        ...existing,
        ...input,
        updatedAt
      };
    } catch (error) {
      this.events.emit("db:transaction:rollback", { ...tx, error: String(error) });
      throw error;
    }
  }

  async delete(resource: DefineResourceResult, id: string, audit?: RequestAudit): Promise<Record<string, unknown> | null> {
    const existing = await this.get(resource, id);
    if (!existing) {
      return null;
    }

    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = schemaPrefix + quoteIdentifier(this.config.client, resource.table ?? resource.resource);
    const tenantClause = (this.multiTenancy?.enabled && this.tenantId)
      ? ` AND ${quoteIdentifier(this.config.client, this.multiTenancy.tenantIdField ?? "tenant_id")} = ${escapeValue(this.config.client, this.tenantId)}`
      : "";
    const query = `DELETE FROM ${table} WHERE id = ${escapeValue(this.config.client, id)}${tenantClause}`;
    const tx = buildTransactionPayload(resource, "delete", query);
    this.events.emit("db:transaction:before", tx);

    try {
      await this.sql.begin(async (sql) => {
        await sql.unsafe(query);
      });
      this.events.emit("db:transaction:after", tx);
      return existing;
    } catch (error) {
      this.events.emit("db:transaction:rollback", { ...tx, error: String(error) });
      throw error;
    }
  }

  async ensureAuditTable(): Promise<void> {
    if (this.config.client === "postgresql") {
      let schemaPrefix = "";
      if (this.config.schema && this.config.schema !== "public") {
        schemaPrefix = `"${this.config.schema}".`;
      }
      const ddl = `
        CREATE TABLE IF NOT EXISTS ${schemaPrefix}"_audit_logs" (
          "id"              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
          "resource"        TEXT        NOT NULL,
          "action"          TEXT        NOT NULL CHECK (action IN ('create', 'update', 'delete')),
          "record_id"       TEXT        NOT NULL,
          "actor_subject"   TEXT        NOT NULL,
          "actor_strategy"  TEXT        NOT NULL,
          "old_value"       JSONB,
          "new_value"       JSONB,
          "request_id"      TEXT        NOT NULL,
          "request_path"    TEXT        NOT NULL,
          "timestamp"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS "_audit_logs_resource_record_idx"
          ON ${schemaPrefix}"_audit_logs" ("resource", "record_id");`;
      await this.sql.unsafe(ddl);
    } else {
      const ddl = `
        CREATE TABLE IF NOT EXISTS \`_audit_logs\` (
          \`id\` VARCHAR(191) PRIMARY KEY,
          \`resource\` TEXT NOT NULL,
          \`action\` TEXT NOT NULL,
          \`record_id\` TEXT NOT NULL,
          \`actor_subject\` TEXT NOT NULL,
          \`actor_strategy\` TEXT NOT NULL,
          \`old_value\` TEXT NOT NULL,
          \`new_value\` TEXT NOT NULL,
          \`request_id\` TEXT NOT NULL,
          \`request_path\` TEXT NOT NULL,
          \`timestamp\` TEXT NOT NULL
        )`;
      await this.sql.unsafe(ddl);
    }
  }

  async ensureCronLogTable(): Promise<void> {
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = this.config.client === "postgresql" ? `${schemaPrefix}"lumora_cron_log"` : "`lumora_cron_log`";
    if (this.config.client === "postgresql") {
      await this.sql.unsafe(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id SERIAL PRIMARY KEY,
          task_name TEXT NOT NULL,
          executed_at TIMESTAMPTZ NOT NULL,
          duration_ms INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
          error_message TEXT
        );
      `);
    } else {
      await this.sql.unsafe(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_name TEXT NOT NULL,
          executed_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          status TEXT NOT NULL,
          error_message TEXT
        );
      `);
    }
  }

  async writeCronLog(name: string, durationMs: number, error?: string): Promise<void> {
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = this.config.client === "postgresql" ? `${schemaPrefix}"lumora_cron_log"` : "`lumora_cron_log`";
    const now = new Date().toISOString();
    const status = error ? "failed" : "success";
    const errorMsg = error ? escapeValue(this.config.client, String(error)) : "NULL";
    await this.sql.unsafe(`
      INSERT INTO ${table} (task_name, executed_at, duration_ms, status, error_message)
      VALUES (${escapeValue(this.config.client, name)}, '${now}', ${durationMs}, '${status}', ${errorMsg})
    `);
  }

  async writeAuditLog(entry: Omit<AuditLogRecord, "id">): Promise<void> {
    const id = crypto.randomUUID();
    const columns = Object.keys({ id, ...entry }).map(k => quoteIdentifier(this.config.client, k)).join(", ");
    const values = Object.values({ id, ...entry })
      .map((v) => escapeValue(this.config.client, v))
      .join(", ");
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = this.config.client === "postgresql" ? `${schemaPrefix}"_audit_logs"` : "`_audit_logs`";
    await this.sql.unsafe(
      `INSERT INTO ${table} (${columns}) VALUES (${values})`
    );
  }

  // LS-2: Internal helpers for relation resolution (bypass filterable restriction)
  async getByField(
    resource: DefineResourceResult,
    field: string,
    value: unknown
  ): Promise<Record<string, unknown> | null> {
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = schemaPrefix + quoteIdentifier(this.config.client, resource.table ?? resource.resource);
    const tenantClause = (this.multiTenancy?.enabled && this.tenantId)
      ? ` AND ${quoteIdentifier(this.config.client, this.multiTenancy.tenantIdField ?? "tenant_id")} = ${escapeValue(this.config.client, this.tenantId)}`
      : "";
    const select = buildSelectClause(this.config.client, resource);
    const query = `SELECT ${select} FROM ${table} WHERE ${quoteIdentifier(this.config.client, field)} = ${escapeValue(this.config.client, value)}${tenantClause} LIMIT 1`;
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(query);
    return rows[0] ? normalizeRecord(rows[0], resource) : null;
  }

  async listByField(
    resource: DefineResourceResult,
    field: string,
    value: unknown,
    limit = 1000
  ): Promise<Record<string, unknown>[]> {
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = schemaPrefix + quoteIdentifier(this.config.client, resource.table ?? resource.resource);
    const tenantClause = (this.multiTenancy?.enabled && this.tenantId)
      ? ` AND ${quoteIdentifier(this.config.client, this.multiTenancy.tenantIdField ?? "tenant_id")} = ${escapeValue(this.config.client, this.tenantId)}`
      : "";
    const select = buildSelectClause(this.config.client, resource);
    const query = `SELECT ${select} FROM ${table} WHERE ${quoteIdentifier(this.config.client, field)} = ${escapeValue(this.config.client, value)}${tenantClause} ORDER BY updated_at DESC LIMIT ${limit}`;
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(query);
    return rows.map((row) => normalizeRecord(row, resource));
  }

  /** Batch fetch by primary key. Returns id → normalized record map. O(1) queries regardless of list size. */
  async getByIds(
    resource: DefineResourceResult,
    ids: string[]
  ): Promise<Map<string, Record<string, unknown>>> {
    if (ids.length === 0) return new Map();
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table  = schemaPrefix + quoteIdentifier(this.config.client, resource.table ?? resource.resource);
    const select = buildSelectClause(this.config.client, resource);
    const inList = [...new Set(ids)].map(id => escapeValue(this.config.client, id)).join(", ");
    
    // For tenancy, we technically should include tenant checks here too for safety, 
    // but the caller list already filtered by tenant. Still, adding for consistency.
    const tenantClause = (this.multiTenancy?.enabled && this.tenantId)
      ? ` AND ${quoteIdentifier(this.config.client, this.multiTenancy.tenantIdField ?? "tenant_id")} = ${escapeValue(this.config.client, this.tenantId)}`
      : "";

    const rows   = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT ${select} FROM ${table} WHERE id IN (${inList})${tenantClause}`
    );
    const result = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const normalized = normalizeRecord(row, resource);
      result.set(String(normalized.id), normalized);
    }
    return result;
  }

  /** Batch fetch by FK field — returns all rows where field IN (values). Used for hasMany batch resolution. */
  async listByIds(
    resource: DefineResourceResult,
    field: string,
    values: unknown[]
  ): Promise<Record<string, unknown>[]> {
    if (values.length === 0) return [];
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table  = schemaPrefix + quoteIdentifier(this.config.client, resource.table ?? resource.resource);
    const select = buildSelectClause(this.config.client, resource);
    const inList = [...new Set(values)].map(v => escapeValue(this.config.client, v)).join(", ");
    
    const tenantClause = (this.multiTenancy?.enabled && this.tenantId)
      ? ` AND ${quoteIdentifier(this.config.client, this.multiTenancy.tenantIdField ?? "tenant_id")} = ${escapeValue(this.config.client, this.tenantId)}`
      : "";

    const rows   = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT ${select} FROM ${table} WHERE ${quoteIdentifier(this.config.client, field)} IN (${inList})${tenantClause} ORDER BY updated_at DESC`
    );
    return rows.map(row => normalizeRecord(row, resource));
  }

  // LS-4: Bulk create with optional transaction wrapping
  async createBulk(
    resource: DefineResourceResult,
    inputs: Record<string, unknown>[],
    audit?: RequestAudit
  ): Promise<BulkResult[]> {
    if (inputs.length === 0) return [];

    if (this.multiTenancy?.enabled && this.tenantId) {
      const tenantField = this.multiTenancy.tenantIdField ?? "tenant_id";
      inputs = inputs.map(i => ({ ...i, [tenantField]: this.tenantId }));
    }

    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = schemaPrefix + quoteIdentifier(this.config.client, resource.table ?? resource.resource);
    const now = new Date().toISOString();
    const transactional = resource.bulk?.transactional !== false; // default true

    // Prepare all records and their INSERT queries
    const prepared: { record: Record<string, unknown>; query: string }[] = inputs.map((input) => {
      const id = crypto.randomUUID();
      const record = { id, ...input, created_at: now, updated_at: now };
      const columns = Object.keys(record).map(k => quoteIdentifier(this.config.client, k)).join(", ");
      const values = Object.entries(record)
        .map(([key, value]) => escapeValue(this.config.client, value, key in resource.fields ? resource.fields[key] : undefined))
        .join(", ");
      return { record, query: `INSERT INTO ${table} (${columns}) VALUES (${values})` };
    });

    if (transactional) {
      const tx = buildTransactionPayload(resource, "create", `BULK INSERT ${prepared.length} records into ${table}`);
      this.events.emit("db:transaction:before", tx);
      try {
        await this.sql.begin(async (sql) => {
          for (const { query } of prepared) {
            await sql.unsafe(query);
          }
        });
        this.events.emit("db:transaction:after", tx);
        return prepared.map(({ record }) => ({
          success: true,
          id: record.id as string,
          data: normalizeRecord(record, resource)
        }));
      } catch (error) {
        this.events.emit("db:transaction:rollback", { ...tx, error: String(error) });
        // Entire batch failed — return error for all
        return inputs.map(() => ({ success: false, error: String(error) }));
      }
    } else {
      // Non-transactional: attempt each independently
      const results: BulkResult[] = [];
      for (const { record, query } of prepared) {
        const tx = buildTransactionPayload(resource, "create", query);
        this.events.emit("db:transaction:before", tx);
        try {
          await this.sql.begin(async (sql) => { await sql.unsafe(query); });
          this.events.emit("db:transaction:after", tx);
          results.push({ success: true, id: record.id as string, data: normalizeRecord(record, resource) });
        } catch (error) {
          this.events.emit("db:transaction:rollback", { ...tx, error: String(error) });
          results.push({ success: false, error: String(error) });
        }
      }
      return results;
    }
  }

  // ─── Migration Seam ──────────────────────────────────────────────────────

  /**
   * Create the _migrations ledger table if it does not exist.
   * Called once by LumoraMigrationEngine before any ledger reads.
   */
  async ensureMigrationsTable(): Promise<void> {
    const isMySQL = this.config.client === "mysql";
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const ddl = this.config.client === "postgresql"
      ? `CREATE TABLE IF NOT EXISTS ${schemaPrefix}"_migrations" (
          "id"         SERIAL      PRIMARY KEY,
          "name"       TEXT        NOT NULL UNIQUE,
          "checksum"   TEXT        NOT NULL,
          "applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`
      : (this.config.client === "mysql"
      ? `CREATE TABLE IF NOT EXISTS \`_migrations\` (
          \`id\`         BIGINT AUTO_INCREMENT PRIMARY KEY,
          \`name\`       VARCHAR(512) NOT NULL UNIQUE,
          \`checksum\`   VARCHAR(64)  NOT NULL,
          \`applied_at\` TEXT         NOT NULL
        )`
      : `CREATE TABLE IF NOT EXISTS \`_migrations\` (
          \`id\`         INTEGER PRIMARY KEY AUTOINCREMENT,
          \`name\`       TEXT NOT NULL UNIQUE,
          \`checksum\`   TEXT NOT NULL,
          \`applied_at\` TEXT NOT NULL
        )`);
    await this.sql.unsafe(ddl);
  }

  /**
   * Return all applied migrations ordered by id (insertion order).
   */
  async getAppliedMigrations(): Promise<MigrationRecord[]> {
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = this.config.client === "postgresql" ? `${schemaPrefix}"_migrations"` : "`_migrations`";
    const rows = await this.sql.unsafe<MigrationRecord[]>(
      `SELECT id, name, checksum, applied_at FROM ${table} ORDER BY id ASC`
    );
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }

  /**
   * Record a successfully applied migration in the ledger.
   */
  async recordMigration(name: string, checksum: string): Promise<void> {
    const applied_at = new Date().toISOString();
    let schemaPrefix = "";
    if (this.config.client === "postgresql" && this.config.schema && this.config.schema !== "public") {
      schemaPrefix = `"${this.config.schema}".`;
    }
    const table = this.config.client === "postgresql" ? `${schemaPrefix}"_migrations"` : "`_migrations`";
    const cols = this.config.client === "postgresql" ? `"name", "checksum", "applied_at"` : "`name`, `checksum`, `applied_at`";
    await this.sql.unsafe(
      `INSERT INTO ${table} (${cols}) VALUES (${escapeValue(this.config.client, name)}, ${escapeValue(this.config.client, checksum)}, ${escapeValue(this.config.client, applied_at)})`
    );
  }
}
