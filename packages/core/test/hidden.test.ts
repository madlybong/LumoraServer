import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";

async function createFixtureApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-hidden-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    path.join(routesDir, "user.ts"),
    `export default {
  kind: "resource",
  resource: "user",
  fields: {
    email: { type: "string", required: true },
    display_name: { type: "string" },
    password_hash: { type: "string", hidden: true }
  }
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

describe("Hidden fields", () => {
  test("hidden fields are stripped from GET list response", async () => {
    const { lumora } = await createFixtureApp();

    await lumora.app.request("/api/v1/user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", display_name: "Alice", password_hash: "$2b$hash" })
    });

    const listRes = await lumora.app.request("/api/v1/user");
    const body = await listRes.json() as any;
    expect(body.data.length).toBe(1);
    expect(body.data[0].email).toBe("a@b.com");
    expect(body.data[0].display_name).toBe("Alice");
    expect(body.data[0].password_hash).toBeUndefined();

    await lumora.close();
  });

  test("hidden fields are stripped from GET one response", async () => {
    const { lumora } = await createFixtureApp();

    const createRes = await lumora.app.request("/api/v1/user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "b@c.com", password_hash: "$2b$secret" })
    });
    const created = (await createRes.json() as any).data;

    const getRes = await lumora.app.request(`/api/v1/user/${created.id}`);
    const record = (await getRes.json() as any).data;
    expect(record.email).toBe("b@c.com");
    expect(record.password_hash).toBeUndefined();

    await lumora.close();
  });
});
