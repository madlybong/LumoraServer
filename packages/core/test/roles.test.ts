import { describe, expect, test } from "bun:test";
import { initLumora } from "../src/runtime";

// Tests for declarative roles-based permission shorthand.
// Uses inline resources (config.resources) for parallel-safe test isolation.

function createJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  const key = new TextEncoder().encode(secret);
  const signature = new Bun.CryptoHasher("sha256", key).update(data).digest("base64url");
  return `${data}.${signature}`;
}

const SECRET = "roles-test-secret-key-at-least-32ch";

async function makeRolesApp() {
  return initLumora({
    name: "fixture",
    mode: "production",
    api: { base: "/api", version: "v1" },
    auth: { mode: "jwt", secret: SECRET },
    database: { client: "sqlite", url: "sqlite://:memory:" },
    resources: [{
      resource: "order",
      fields: {
        amount: { type: "number", required: true }
      },
      permissions: {
        // Global roles: only vendor-maker and manager can access this resource
        roles: ["vendor-maker", "manager"]
      }
    } as any]
  });
}

describe("Declarative roles shorthand", () => {
  test("user with matching role can POST", async () => {
    const lumora = await makeRolesApp();
    const token = createJwt({ sub: "user1", roles: ["vendor-maker"] }, SECRET);

    const res = await lumora.app.request("/api/v1/order", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: 100 })
    });
    expect(res.status).toBe(201);

    await lumora.close();
  });

  test("user without matching role gets 403", async () => {
    const lumora = await makeRolesApp();
    const token = createJwt({ sub: "user2", roles: ["viewer"] }, SECRET);

    const res = await lumora.app.request("/api/v1/order", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: 100 })
    });
    expect(res.status).toBe(403);

    await lumora.close();
  });

  test("super-admin bypasses role checks", async () => {
    const lumora = await makeRolesApp();
    const token = createJwt({ sub: "admin", roles: ["super-admin"] }, SECRET);

    const res = await lumora.app.request("/api/v1/order", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: 999 })
    });
    expect(res.status).toBe(201);

    await lumora.close();
  });

  test("methods without roles config pass through", async () => {
    // Resource with no permissions — any valid JWT user can access
    const lumora = await initLumora({
      name: "fixture",
      mode: "production",
      api: { base: "/api", version: "v1" },
      auth: { mode: "jwt", secret: SECRET },
      database: { client: "sqlite", url: "sqlite://:memory:" },
      resources: [{
        resource: "openorder",
        fields: { amount: { type: "number", required: true } }
      } as any]
    });

    const token = createJwt({ sub: "anyone", roles: ["viewer"] }, SECRET);
    const res = await lumora.app.request("/api/v1/openorder", {
      headers: { authorization: `Bearer ${token}` }
    });
    // GET_LIST has no roles restriction, should pass
    expect(res.status).toBe(200);

    await lumora.close();
  });
});
