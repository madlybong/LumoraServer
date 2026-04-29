import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";

async function createFixtureApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-cors-"));
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

  return { root, routesDir };
}

describe("CORS", () => {
  test("development mode sets Access-Control-Allow-Origin: *", async () => {
    const { routesDir } = await createFixtureApp();
    const lumora = await initLumora({
      name: "fixture",
      mode: "development",
      api: { base: "/api", version: "v1" },
      auth: { mode: "disabled" },
      database: { client: "sqlite", url: "sqlite://:memory:" },
      routes: { dir: routesDir }
    });

    const res = await lumora.app.request("/api/v1/post", {
      headers: { origin: "http://localhost:5173" }
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    await lumora.close();
  });

  test("OPTIONS preflight returns 204", async () => {
    const { routesDir } = await createFixtureApp();
    const lumora = await initLumora({
      name: "fixture",
      mode: "development",
      api: { base: "/api", version: "v1" },
      auth: { mode: "disabled" },
      database: { client: "sqlite", url: "sqlite://:memory:" },
      routes: { dir: routesDir }
    });

    const res = await lumora.app.request("/api/v1/post", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173" }
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");

    await lumora.close();
  });

  test("production mode with no cors config rejects origin", async () => {
    const { routesDir } = await createFixtureApp();
    const lumora = await initLumora({
      name: "fixture",
      mode: "production",
      api: { base: "/api", version: "v1" },
      auth: { mode: "static", token: "secret" },
      database: { client: "sqlite", url: "sqlite://:memory:" },
      routes: { dir: routesDir }
    });

    const res = await lumora.app.request("/api/v1/post", {
      headers: { origin: "http://evil.com", authorization: "Bearer secret" }
    });
    // No Access-Control-Allow-Origin header should be set
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();

    await lumora.close();
  });

  test("explicit cors.origin in production allows matching origin", async () => {
    const { routesDir } = await createFixtureApp();
    const lumora = await initLumora({
      name: "fixture",
      mode: "production",
      api: { base: "/api", version: "v1" },
      auth: { mode: "static", token: "secret" },
      database: { client: "sqlite", url: "sqlite://:memory:" },
      routes: { dir: routesDir },
      cors: { origin: "https://app.example.com" }
    });

    const res = await lumora.app.request("/api/v1/post", {
      headers: { origin: "https://app.example.com", authorization: "Bearer secret" }
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");

    await lumora.close();
  });
});
