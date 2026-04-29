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
  // Use synchronous HMAC via Bun's crypto
  const signature = new Bun.CryptoHasher("sha256", key).update(data).digest("base64url");
  return `${data}.${signature}`;
}

async function createJwtApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-jwt-exp-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    path.join(routesDir, "post.ts"),
    `export default {
  kind: "resource",
  resource: "post",
  fields: { title: { type: "string" } }
};`
  );

  const secret = "test-secret-key";
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

describe("JWT expiry validation", () => {
  test("valid JWT with future exp succeeds", async () => {
    const { lumora, secret } = await createJwtApp();
    const token = createJwt({ sub: "user1", exp: Math.floor(Date.now() / 1000) + 3600 }, secret);

    const res = await lumora.app.request("/api/v1/post", {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);

    await lumora.close();
  });

  test("expired JWT returns 401", async () => {
    const { lumora, secret } = await createJwtApp();
    const token = createJwt({ sub: "user1", exp: Math.floor(Date.now() / 1000) - 60 }, secret);

    const res = await lumora.app.request("/api/v1/post", {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toContain("expired");

    await lumora.close();
  });

  test("JWT with no exp field still works (backward compat)", async () => {
    const { lumora, secret } = await createJwtApp();
    const token = createJwt({ sub: "user1" }, secret);

    const res = await lumora.app.request("/api/v1/post", {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);

    await lumora.close();
  });
});
