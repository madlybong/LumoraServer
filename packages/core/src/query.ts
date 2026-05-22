import type { LumoraAuthResult, DefineResourceResult } from "./types";
import type { LumoraDatabase } from "./db";

// ---------------------------------------------------------------------------
// LS-11: Structured Query Interface
// ---------------------------------------------------------------------------

export type FilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "in";

export interface FilterClause {
  field: string;
  operator?: FilterOperator; // default "eq"
  value: unknown;
}

export interface SortClause {
  field: string;
  direction?: "asc" | "desc"; // default "asc"
}

export interface QueryDescriptor {
  resource: string;
  filters?: FilterClause[];
  sort?: SortClause;
  limit?: number;
  offset?: number;
  include?: string[];
  computed?: string[];
}

export type QueryResult = {
  ok: true;
  data: Record<string, unknown>[];
  total?: number;
} | {
  ok: false;
  error: string;
};

export interface QueryExecutor {
  execute(
    descriptor: QueryDescriptor,
    context: {
      auth?: LumoraAuthResult;
      resources: DefineResourceResult[];
      database: LumoraDatabase;
    }
  ): Promise<QueryResult>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createQueryExecutor(): QueryExecutor {
  return {
    async execute(descriptor, { auth, resources, database }) {
      // 1. Validate resource exists
      const resource = resources.find((r) => r.resource === descriptor.resource);
      if (!resource) {
        return { ok: false, error: `Unknown resource: "${descriptor.resource}"` };
      }

      // 2. Validate filter fields against declared schema
      if (descriptor.filters) {
        for (const filter of descriptor.filters) {
          if (!(filter.field in resource.fields)) {
            return { ok: false, error: `Unknown field "${filter.field}" on resource "${descriptor.resource}"` };
          }
        }
      }

      // 3. Validate sort field
      if (descriptor.sort && !(descriptor.sort.field in resource.fields)) {
        return { ok: false, error: `Unknown sort field "${descriptor.sort.field}" on resource "${descriptor.resource}"` };
      }

      // 4. Build proper ListOptions for database.list()
      // filters must be a URLSearchParams, page/pageSize are required
      const searchParams = new URLSearchParams();

      // Add filter params — temporarily mark fields as filterable for this query
      // by appending them to URLSearchParams in the format the runtime uses
      if (descriptor.filters) {
        for (const f of descriptor.filters) {
          const op = f.operator ?? "eq";
          if (op === "eq") {
            searchParams.set(f.field, String(f.value));
          } else {
            searchParams.set(`${f.field}:${op}`, String(f.value));
          }
        }
      }

      const pageSize = descriptor.limit ?? 10_000;
      const page = descriptor.offset !== undefined
        ? Math.floor(descriptor.offset / pageSize) + 1
        : 1;

      // Build scope from auth (LS-9 integration)
      let scope: { field: string; value: unknown } | undefined;
      if (auth?.scope && resource.permissions?.scope?.field) {
        const scopeField = resource.permissions.scope.field;
        const scopeValue = auth.scope[scopeField];
        if (scopeValue !== undefined) {
          scope = { field: scopeField, value: scopeValue };
        }
      }

      // Temporarily mark filter/sort fields as filterable and sortable on the resource schema
      // by creating an augmented resource definition for the query scope
      const augmentedResource: DefineResourceResult = {
        ...resource,
        fields: Object.fromEntries(
          Object.entries(resource.fields).map(([name, field]) => [
            name,
            { ...field, filterable: true, sortable: true }
          ])
        )
      };

      // 5. Execute via database.list()
      // Sort format: "-fieldname" for DESC, "fieldname" for ASC (matches buildSortClause)
      let sortString: string | undefined;
      if (descriptor.sort) {
        sortString = descriptor.sort.direction === "desc"
          ? `-${descriptor.sort.field}`
          : descriptor.sort.field;
      }

      let rows: Record<string, unknown>[];
      let total: number;
      try {
        const result = await database.list(augmentedResource, {
          filters: searchParams,
          search: undefined,
          sort: sortString,
          page,
          pageSize,
          scope
        });
        rows = result.items;
        total = result.total;
      } catch (err) {
        return { ok: false, error: `Database error: ${String(err)}` };
      }

      // 6. Apply computed fields (LS-1)
      if (descriptor.computed && resource.computed) {
        for (const row of rows) {
          for (const fieldName of descriptor.computed) {
            const computedField = resource.computed[fieldName];
            if (computedField) {
              try {
                row[fieldName] = await computedField.resolve(row, { auth, database });
              } catch (_err) {
                row[fieldName] = null;
              }
            }
          }
        }
      }

      // 7. Apply relational includes (LS-2)
      if (descriptor.include && resource.relations) {
        for (const includeKey of descriptor.include) {
          const rel = resource.relations[includeKey];
          if (!rel) continue;

          const relResource = resources.find((r) => r.resource === rel.resource);
          if (!relResource) continue;

          for (const row of rows) {
            if (rel.type === "belongsTo") {
              const fkValue = row[rel.foreignKey];
              if (fkValue == null) { row[includeKey] = null; continue; }
              const matchField = rel.matchOn ?? "id";
              const [related] = await database.listByField(relResource, matchField, String(fkValue));
              row[includeKey] = related ?? null;
            } else if (rel.type === "hasMany") {
              const fkValue = row["id"];
              if (fkValue == null) { row[includeKey] = []; continue; }
              const related = await database.listByField(relResource, rel.foreignKey, String(fkValue));
              row[includeKey] = related;
            }
          }
        }
      }

      return { ok: true, data: rows, total };
    },
  };
}
