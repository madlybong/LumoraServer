import type { Context, Next } from "hono";
import type { LumoraPrincipal } from "./types";

/**
 * Ensures the user is authenticated.
 * If authentication fails or is not present, it returns a 401 response.
 */
export function requireAuth() {
  return async (c: Context, next: Next) => {
    const user = c.get("user");
    if (!user || !user.subject) {
      if (c.var.fail) {
        return c.var.fail("UNAUTHORIZED", "Authentication required", 401);
      }
      return c.json({ ok: false, error: "Authentication required" }, 401);
    }
    await next();
  };
}

/**
 * Ensures the user has at least one of the required roles.
 * Super-admin bypasses this check.
 */
export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as LumoraPrincipal | undefined;
    if (!user || !user.subject) {
      if (c.var.fail) {
        return c.var.fail("UNAUTHORIZED", "Authentication required", 401);
      }
      return c.json({ ok: false, error: "Authentication required" }, 401);
    }

    const userRoles = user.roles || [];
    if (
      !userRoles.includes("super-admin") &&
      !roles.some((r) => userRoles.includes(r))
    ) {
      if (c.var.fail) {
        return c.var.fail("FORBIDDEN", "Insufficient permissions", 403);
      }
      return c.json({ ok: false, error: "Forbidden" }, 403);
    }

    await next();
  };
}

/**
 * Safely extracts the typed principal from the context.
 */
export function getPrincipal(c: Context): LumoraPrincipal {
  return c.get("user") as LumoraPrincipal;
}

/**
 * Standardized validation middleware that maps schema failures
 * to the Lumora HTTP Error envelope.
 */
export function validate(schema: { json?: any; query?: any; params?: any }) {
  return async (c: Context, next: Next) => {
    const valid: any = { json: {}, query: {}, params: {} };
    const errors: Record<string, string[]> = {};

    const validatePart = async (part: "json" | "query" | "params", getter: () => Promise<any> | any) => {
      if (!schema[part]) return;
      try {
        const data = await getter();
        if (schema[part].parse) {
          valid[part] = schema[part].parse(data);
        } else if (schema[part].validateSync) {
          valid[part] = schema[part].validateSync(data);
        } else {
          valid[part] = data; // fallback
        }
      } catch (err: any) {
        // Simple Zod/Yup error mapping extraction
        if (err.errors) {
          errors[part] = err.errors.map((e: any) => e.message || String(e));
        } else {
          errors[part] = [err.message || String(err)];
        }
      }
    };

    if (schema.json) {
      await validatePart("json", () => c.req.json().catch(() => ({})));
    }
    if (schema.query) {
      await validatePart("query", () => c.req.query());
    }
    if (schema.params) {
      await validatePart("params", () => c.req.param());
    }

    if (Object.keys(errors).length > 0) {
      if (c.var.fail) {
        return c.var.fail("VALIDATION_ERROR", "Validation failed", 400, errors);
      }
      return c.json({ ok: false, error: "Validation failed", details: errors }, 400);
    }

    c.set("valid", valid);
    await next();
  };
}
