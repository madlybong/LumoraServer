import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";

function createJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  const key = new TextEncoder().encode(secret);
  const signature = new Bun.CryptoHasher("sha256", key).update(data).digest("base64url");
  return `${data}.${signature}`;
}

async function createRolesApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-roles-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    path.join(routesDir, "order.ts"),
    `export default {
  kind: "resource",
  resource: "order",
  fields: {
    amount: { type: "number", required: true }
  },
  permissions: {
    roles: {
      POST: ["vendor-maker", "sales-rep"],
      DELETE: ["manager"]
    }
  }
};`
  );

  const secret = "roles-test-secret";
  const lumora = await initLumora({
    name: "fixture",
    mode: "production",
    api: { base: "/api", version: "v1" },
    auth: { mode: "jwt", secret },
    database: { client: "sqlite", url: "sqlite://:memory:" },
    routes: { dir: routesDir }
  });

  return { lumora, secret };
}

describe("Declarative roles shorthand", () => {
  test("user with matching role can POST", async () => {
    const { lumora, secret } = await createRolesApp();
    const token = createJwt({ sub: "user1", roles: ["vendor-maker"] }, secret);

    const res = await lumora.app.request("/api/v1/order", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: 100 })
    });
    expect(res.status).toBe(201);

    await lumora.close();
  });

  test("user without matching role gets 403", async () => {
    const { lumora, secret } = await createRolesApp();
    const token = createJwt({ sub: "user2", roles: ["viewer"] }, secret);

    const res = await lumora.app.request("/api/v1/order", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: 100 })
    });
    expect(res.status).toBe(403);

    await lumora.close();
  });

  test("super-admin bypasses role checks", async () => {
    const { lumora, secret } = await createRolesApp();
    const token = createJwt({ sub: "admin", roles: ["super-admin"] }, secret);

    const res = await lumora.app.request("/api/v1/order", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: 999 })
    });
    expect(res.status).toBe(201);

    await lumora.close();
  });

  test("methods without roles config pass through", async () => {
    const { lumora, secret } = await createRolesApp();
    const token = createJwt({ sub: "anyone", roles: ["viewer"] }, secret);

    const res = await lumora.app.request("/api/v1/order", {
      headers: { authorization: `Bearer ${token}` }
    });
    // GET_LIST has no roles restriction, should pass
    expect(res.status).toBe(200);

    await lumora.close();
  });
});
