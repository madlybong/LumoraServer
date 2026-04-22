import type { DefineResourceResult, ResourceFields, ResourceSchema } from "./types";

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
