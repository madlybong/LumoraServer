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

function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, "")}\``;
}

function sqlTextType(client: LumoraDatabaseConfig["client"], field: ResourceField): string {
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

function escapeValue(value: unknown, field?: ResourceField): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (field?.type === "json") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  if (field?.type === "boolean") {
    return value ? "1" : "0";
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
    } else if (field.type === "json" && typeof raw === "string") {
      try {
        normalized[fieldName] = JSON.parse(raw);
      } catch {
        normalized[fieldName] = raw;
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

function buildWhereClause(resource: DefineResourceResult, filters: URLSearchParams, searchTerm?: string): string[] {
  const reservedParams = new Set(["page", "pageSize", "limit", "sort", "search"]);
  const filterable = new Set(resource.query?.filterable ?? Object.keys(resource.fields).filter((key) => resource.fields[key]!.filterable));
  const clauses: string[] = [];

  for (const [key, value] of filters.entries()) {
    if (reservedParams.has(key) || !filterable.has(key)) {
      continue;
    }
    clauses.push(`${quoteIdentifier(key)} = ${escapeValue(value, resource.fields[key])}`);
  }

  if (searchTerm) {
    const searchable = Object.keys(resource.fields).filter((k) => resource.fields[k]!.searchable);
    if (searchable.length > 0) {
      const like = searchable
        .map((k) => `${quoteIdentifier(k)} LIKE ${escapeValue(`%${searchTerm}%`)}`)
        .join(" OR ");
      clauses.push(`(${like})`);
    }
  }

  return clauses;
}

function buildSortClause(resource: DefineResourceResult, sort?: string): string {
  if (!sort) {
    return "ORDER BY updated_at DESC";
  }

  const descending = sort.startsWith("-");
  const field = descending ? sort.slice(1) : sort;
  const sortable = new Set(resource.query?.sortable ?? Object.keys(resource.fields).filter((key) => resource.fields[key]!.sortable));

  if (!sortable.has(field)) {
    return "ORDER BY updated_at DESC";
  }

  return `ORDER BY ${quoteIdentifier(field)} ${descending ? "DESC" : "ASC"}`;
}

function buildTransactionPayload(resource: DefineResourceResult, action: TransactionEventPayload["action"], sql: string): TransactionEventPayload {
  return {
    resource: resource.resource,
    action,
    sql
  };
}

export class LumoraDatabase {
  readonly sql: SQL;

  constructor(
    private readonly config: LumoraDatabaseConfig,
    private readonly events: TypedEventEmitter<LumoraEventMap>
  ) {
    this.sql = new SQL(config.url, config.client === "mysql" ? { adapter: "mysql" } : { adapter: "sqlite" });
  }

  async connect(): Promise<void> {
    await this.sql.connect();
  }

  async close(): Promise<void> {
    await this.sql.close();
  }

  async ensureResource(resource: DefineResourceResult): Promise<void> {
    const tableName = resource.table ?? resource.resource;
    const table = quoteIdentifier(tableName);
    const fieldLines = Object.entries(resource.fields).map(([name, field]) => {
      const suffix = field.required ? " NOT NULL" : "";
      return `${quoteIdentifier(name)} ${sqlTextType(this.config.client, field)}${suffix}`;
    });
    const ddl = [
      `CREATE TABLE IF NOT EXISTS ${table} (`,
      `${quoteIdentifier("id")} VARCHAR(191) PRIMARY KEY,`,
      ...fieldLines.map((line) => `${line},`),
      `${quoteIdentifier("created_at")} TEXT NOT NULL,`,
      `${quoteIdentifier("updated_at")} TEXT NOT NULL`,
      ")"
    ].join(" ");
    await this.sql.unsafe(ddl);

    for (const [name, field] of Object.entries(resource.fields)) {
      if (field.unique) {
        await this.sql.unsafe(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${tableName}_${name}_unique`)} ON ${table} (${quoteIdentifier(name)})`
        );
      } else if (field.indexed) {
        await this.sql.unsafe(
          `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${tableName}_${name}`)} ON ${table} (${quoteIdentifier(name)})`
        );
      }
    }
  }

  async list(resource: DefineResourceResult, options: ListOptions): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
    const table = quoteIdentifier(resource.table ?? resource.resource);
    const where = buildWhereClause(resource, options.filters, options.search);
    // LS-9: inject scope as a non-bypassable WHERE condition (cannot be overridden by user filters)
    if (options.scope) {
      where.push(`${quoteIdentifier(options.scope.field)} = ${escapeValue(options.scope.value)}`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const sort = buildSortClause(resource, options.sort);
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
    const table = quoteIdentifier(resource.table ?? resource.resource);
    const query = `SELECT * FROM ${table} WHERE id = ${escapeValue(id)} LIMIT 1`;
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(query);
    return rows[0] ? normalizeRecord(rows[0], resource) : null;
  }

  async create(
    resource: DefineResourceResult,
    input: Record<string, unknown>,
    audit?: RequestAudit
  ): Promise<Record<string, unknown>> {
    const table = quoteIdentifier(resource.table ?? resource.resource);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const record = {
      id,
      ...input,
      created_at: now,
      updated_at: now
    };
    const columns = Object.keys(record).map(quoteIdentifier).join(", ");
    const values = Object.entries(record)
      .map(([key, value]) => escapeValue(value, key in resource.fields ? resource.fields[key] : undefined))
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

    const table = quoteIdentifier(resource.table ?? resource.resource);
    const updatedAt = new Date().toISOString();
    const assignments = Object.entries(input)
      .map(([key, value]) => `${quoteIdentifier(key)} = ${escapeValue(value, resource.fields[key])}`)
      .concat(`${quoteIdentifier("updated_at")} = ${escapeValue(updatedAt)}`)
      .join(", ");
    const query = `UPDATE ${table} SET ${assignments} WHERE id = ${escapeValue(id)}`;
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

    const table = quoteIdentifier(resource.table ?? resource.resource);
    const query = `DELETE FROM ${table} WHERE id = ${escapeValue(id)}`;
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

  async writeAuditLog(entry: Omit<AuditLogRecord, "id">): Promise<void> {
    const id = crypto.randomUUID();
    const columns = Object.keys({ id, ...entry }).map(quoteIdentifier).join(", ");
    const values = Object.values({ id, ...entry })
      .map((v) => escapeValue(v))
      .join(", ");
    await this.sql.unsafe(
      `INSERT INTO \`_audit_logs\` (${columns}) VALUES (${values})`
    );
  }

  // LS-2: Internal helpers for relation resolution (bypass filterable restriction)
  async getByField(
    resource: DefineResourceResult,
    field: string,
    value: unknown
  ): Promise<Record<string, unknown> | null> {
    const table = quoteIdentifier(resource.table ?? resource.resource);
    const query = `SELECT * FROM ${table} WHERE ${quoteIdentifier(field)} = ${escapeValue(value)} LIMIT 1`;
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(query);
    return rows[0] ? normalizeRecord(rows[0], resource) : null;
  }

  async listByField(
    resource: DefineResourceResult,
    field: string,
    value: unknown,
    limit = 1000
  ): Promise<Record<string, unknown>[]> {
    const table = quoteIdentifier(resource.table ?? resource.resource);
    const query = `SELECT * FROM ${table} WHERE ${quoteIdentifier(field)} = ${escapeValue(value)} ORDER BY updated_at DESC LIMIT ${limit}`;
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(query);
    return rows.map((row) => normalizeRecord(row, resource));
  }

  // LS-4: Bulk create with optional transaction wrapping
  async createBulk(
    resource: DefineResourceResult,
    inputs: Record<string, unknown>[],
    audit?: RequestAudit
  ): Promise<BulkResult[]> {
    if (inputs.length === 0) return [];

    const table = quoteIdentifier(resource.table ?? resource.resource);
    const now = new Date().toISOString();
    const transactional = resource.bulk?.transactional !== false; // default true

    // Prepare all records and their INSERT queries
    const prepared: { record: Record<string, unknown>; query: string }[] = inputs.map((input) => {
      const id = crypto.randomUUID();
      const record = { id, ...input, created_at: now, updated_at: now };
      const columns = Object.keys(record).map(quoteIdentifier).join(", ");
      const values = Object.entries(record)
        .map(([key, value]) => escapeValue(value, key in resource.fields ? resource.fields[key] : undefined))
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
    const ddl = isMySQL
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
        )`;
    await this.sql.unsafe(ddl);
  }

  /**
   * Return all applied migrations ordered by id (insertion order).
   */
  async getAppliedMigrations(): Promise<MigrationRecord[]> {
    const rows = await this.sql.unsafe<MigrationRecord[]>(
      `SELECT id, name, checksum, applied_at FROM \`_migrations\` ORDER BY id ASC`
    );
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }

  /**
   * Record a successfully applied migration in the ledger.
   */
  async recordMigration(name: string, checksum: string): Promise<void> {
    const applied_at = new Date().toISOString();
    await this.sql.unsafe(
      `INSERT INTO \`_migrations\` (\`name\`, \`checksum\`, \`applied_at\`) VALUES (${escapeValue(name)}, ${escapeValue(checksum)}, ${escapeValue(applied_at)})`
    );
  }
}
