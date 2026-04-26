import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { initLumora } from "../src/runtime";
import type { ResourcePermissionContext } from "../src/types";

async function createFixtureApp(guardLogic: string = "") {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-permissions-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    path.join(routesDir, "post.ts"),
    `export default {
  kind: "resource",
  resource: "post",
  fields: {
    title: { type: "string", required: true }
  },
  ${guardLogic}
};`
  );

  const lumora = await initLumora({
    name: "fixture",
    mode: "development",
    api: { base: "/api", version: "v1" },
    auth: { mode: "disabled" },
    database: { client: "sqlite", url: "sqlite://:memory:" },
    routes: { dir: routesDir }
  });

  return { root, lumora };
}

describe("Permission Hooks", () => {
  test("No permissions config -> all methods pass through", async () => {
    const { lumora } = await createFixtureApp();
    
    // POST
    const createRes = await lumora.app.request("/api/v1/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hello" })
    });
    expect(createRes.status).toBe(201);
    
    // GET_LIST
    const listRes = await lumora.app.request("/api/v1/post");
    expect(listRes.status).toBe(200);

    await lumora.close();
  });

  test("Guard that returns normally proceeds", async () => {
    const { lumora } = await createFixtureApp(`
      permissions: {
        POST: async (ctx) => {
          // let it pass
        }
      }
    `);
    
    const createRes = await lumora.app.request("/api/v1/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hello" })
    });
    expect(createRes.status).toBe(201);

    await lumora.close();
  });

  test("Guard that throws Forbidden returns 403", async () => {
    const { lumora } = await createFixtureApp(`
      permissions: {
        POST: async (ctx) => {
          throw new Error("Forbidden");
        }
      }
    `);
    
    const createRes = await lumora.app.request("/api/v1/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hello" })
    });
    expect(createRes.status).toBe(403);
    const body = await createRes.json();
    expect(body).toEqual({ ok: false, error: "Error: Forbidden" });

    await lumora.close();
  });

  test("Guards receive correct context (method, auth, id)", async () => {
    let capturedCtx: ResourcePermissionContext | undefined;
    
    const root = await mkdtemp(path.join(os.tmpdir(), "lumora-permissions-ctx-"));
    const routesDir = path.join(root, "routes");
    await mkdir(routesDir, { recursive: true });
    await writeFile(
      path.join(routesDir, "post.ts"),
      `
      export const capturedCtxs = [];
      export default {
        kind: "resource",
        resource: "post",
        fields: { title: { type: "string" } },
        permissions: {
          GET_ONE: (ctx) => { capturedCtxs.push(ctx); }
        }
      };`
    );

    const lumora = await initLumora({
      name: "fixture",
      mode: "production", // enable auth check
      api: { base: "/api", version: "v1" },
      auth: { mode: "static", token: "secret" },
      database: { client: "sqlite", url: "sqlite://:memory:" },
      routes: { dir: routesDir }
    });

    // Create bypass to setup data
    const createRes = await lumora.app.request("/api/v1/post", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer secret" },
      body: JSON.stringify({ title: "Test" })
    });
    const created = await createRes.json() as any;
    const id = created.data.id;

    const res = await lumora.app.request(`/api/v1/post/${id}`, {
      headers: { authorization: "Bearer secret" }
    });
    expect(res.status).toBe(200);

    const captured = (await import(pathToFileURL(path.join(routesDir, "post.ts")).href)).capturedCtxs[0];
    expect(captured.method).toBe("GET_ONE");
    expect(captured.auth.subject).toBe("static-token");
    expect(captured.id).toBe(id);

    await lumora.close();
  });
});
