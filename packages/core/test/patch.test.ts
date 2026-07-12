import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";

async function createFixtureApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-patch-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    path.join(routesDir, "post.ts"),
    `export default {
  kind: "resource",
  resource: "post",
  fields: {
    title: { type: "string", required: true },
    body: { type: "string" },
    published: { type: "boolean", default: false }
  }
};`
  );

  await writeFile(
    path.join(routesDir, "put_only.ts"),
    `export default {
  kind: "resource",
  resource: "put_only",
  updateMethod: "put",
  fields: { title: { type: "string" } }
};`
  );

  await writeFile(
    path.join(routesDir, "patch_only.ts"),
    `export default {
  kind: "resource",
  resource: "patch_only",
  updateMethod: "patch",
  fields: { title: { type: "string" } }
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

describe("PATCH route", () => {
  test("PATCH partially updates a record", async () => {
    const { lumora } = await createFixtureApp();

    const createRes = await lumora.app.request("/api/v1/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Original", body: "Content", published: false })
    });
    const created = (await createRes.json() as any).data;

    const patchRes = await lumora.app.request(`/api/v1/post/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Updated" })
    });
    expect(patchRes.status).toBe(200);

    const patched = (await patchRes.json() as any).data;
    expect(patched.title).toBe("Updated");
    expect(patched.body).toBe("Content");
    expect(patched.published).toBe(false);

    await lumora.close();
  });

  test("PATCH on non-existent record returns 404", async () => {
    const { lumora } = await createFixtureApp();

    const patchRes = await lumora.app.request("/api/v1/post/nonexistent", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Nope" })
    });
    expect(patchRes.status).toBe(404);

    await lumora.close();
  });

  test("updateMethod: 'put' restricts PATCH route", async () => {
    const { lumora } = await createFixtureApp();
    const patchRes = await lumora.app.request("/api/v1/put_only/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Nope" })
    });
    expect(patchRes.status).toBe(404);
    expect(await patchRes.text()).not.toContain('"ok":false');

    const putRes = await lumora.app.request("/api/v1/put_only/1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Yes" })
    });
    expect(putRes.status).toBe(404);
    expect(await putRes.text()).toContain('"ok":false');
    await lumora.close();
  });

  test("updateMethod: 'patch' restricts PUT route", async () => {
    const { lumora } = await createFixtureApp();
    const putRes = await lumora.app.request("/api/v1/patch_only/1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Nope" })
    });
    expect(putRes.status).toBe(404);
    expect(await putRes.text()).not.toContain('"ok":false');

    const patchRes = await lumora.app.request("/api/v1/patch_only/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Yes" })
    });
    expect(patchRes.status).toBe(404);
    expect(await patchRes.text()).toContain('"ok":false');
    await lumora.close();
  });
});
