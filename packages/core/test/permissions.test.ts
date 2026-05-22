import { describe, expect, test } from "bun:test";
import { initLumora } from "../src/runtime";

// Permissions tests use inline resources (config.resources) to avoid
// Bun ESM module cache collisions when test files run in parallel.

async function makeApp(
  resource: object,
  authMode: "disabled" | "production-static" = "disabled"
) {
  const lumora = await initLumora({
    name: "fixture",
    mode: authMode === "disabled" ? "development" : "production",
    api: { base: "/api", version: "v1" },
    auth: authMode === "disabled"
      ? { mode: "disabled" }
      : { mode: "static", token: "secret" },
    database: { client: "sqlite", url: "sqlite://:memory:" },
    resources: [resource as any]
  });

  const resourceName = (resource as any).resource as string;
  return { lumora, path: `/api/v1/${resourceName}` };
}

describe("Permission Hooks", () => {
  test("No permissions config -> all methods pass through", async () => {
    const { lumora, path: base } = await makeApp({
      resource: "noperms",
      fields: { title: { type: "string", required: true } }
    });

    const createRes = await lumora.app.request(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hello" })
    });
    expect(createRes.status).toBe(201);

    const listRes = await lumora.app.request(base);
    expect(listRes.status).toBe(200);

    await lumora.close();
  });

  test("allow() returning true proceeds", async () => {
    const { lumora, path: base } = await makeApp({
      resource: "allowtrue",
      fields: { title: { type: "string", required: true } },
      permissions: {
        allow: (_auth: unknown, _method: unknown) => true
      }
    });

    const createRes = await lumora.app.request(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hello" })
    });
    expect(createRes.status).toBe(201);

    await lumora.close();
  });

  test("allow() returning false returns 403", async () => {
    const { lumora, path: base } = await makeApp({
      resource: "denyall",
      fields: { title: { type: "string", required: true } },
      permissions: {
        allow: (_auth: unknown, _method: unknown) => false
      }
    });

    const createRes = await lumora.app.request(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hello" })
    });
    expect(createRes.status).toBe(403);
    const body = await createRes.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Forbidden");

    await lumora.close();
  });
});

describe("Declarative roles shorthand", () => {
  test("user without matching role gets 403", async () => {
    const { lumora, path: base } = await makeApp(
      {
        resource: "rolesdeny",
        fields: { title: { type: "string", required: true } },
        permissions: {
          roles: ["admin"]
        }
      },
      "production-static"
    );

    // Static auth doesn't provide roles[], so roles check should reject
    const createRes = await lumora.app.request(base, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer secret"
      },
      body: JSON.stringify({ title: "Hello" })
    });
    expect(createRes.status).toBe(403);
    await lumora.close();
  });

  test("methods without roles config pass through", async () => {
    const { lumora, path: base } = await makeApp({
      resource: "rolesnoop",
      fields: { title: { type: "string", required: true } }
    });
    const listRes = await lumora.app.request(base);
    expect(listRes.status).toBe(200);
    await lumora.close();
  });
});
