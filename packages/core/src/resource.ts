import type { DefineResourceResult, ResourceFields, ResourceSchema } from "./types";

/**
 * Defines and types a Lumora resource schema.
 * 
 * @example
 * ```typescript
 * import { defineResource } from "@astrake/lumora-server";
 * 
 * export default defineResource({
 *   resource: "users",
 *   fields: {
 *     name: { type: "string", required: true },
 *     email: { type: "string", required: true, unique: true }
 *   }
 * });
 * ```
 */
export function defineResource<TFields extends ResourceFields>(
  schema: ResourceSchema<TFields>
): DefineResourceResult<TFields> {
  return {
    kind: "resource",
    ...schema
  };
}

export function normalizeResourcePath(resource: string): string {
  return resource.replace(/^\/+|\/+$/g, "");
}
