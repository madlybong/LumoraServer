import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";

async function createFixtureApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-readonly-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    path.join(routesDir, "invoice.ts"),
    `export default {
  kind: "resource",
  resource: "invoice",
  fields: {
    amount: { type: "number", required: true },
    approved_by: { type: "string", readOnly: true },
    status: { type: "string", default: "draft" }
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

describe("ReadOnly fields", () => {
  test("readOnly fields are silently stripped from POST payload", async () => {
    const { lumora } = await createFixtureApp();

    const res = await lumora.app.request("/api/v1/invoice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 500, approved_by: "hacker", status: "paid" })
    });
    expect(res.status).toBe(201);
    const created = (await res.json() as any).data;
    expect(created.amount).toBe(500);
    expect(created.status).toBe("paid");
    // approved_by should not have been accepted — value is either undefined or null (column exists but no value)
    expect(created.approved_by == null).toBe(true);

    await lumora.close();
  });

  test("readOnly fields are silently stripped from PUT payload", async () => {
    const { lumora } = await createFixtureApp();

    const createRes = await lumora.app.request("/api/v1/invoice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 100 })
    });
    const created = (await createRes.json() as any).data;

    const putRes = await lumora.app.request(`/api/v1/invoice/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 200, approved_by: "tamper" })
    });
    expect(putRes.status).toBe(200);
    const updated = (await putRes.json() as any).data;
    expect(updated.amount).toBe(200);
    expect(updated.approved_by == null).toBe(true);

    await lumora.close();
  });

  test("readOnly fields are silently stripped from PATCH payload", async () => {
    const { lumora } = await createFixtureApp();

    const createRes = await lumora.app.request("/api/v1/invoice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 100 })
    });
    const created = (await createRes.json() as any).data;

    const patchRes = await lumora.app.request(`/api/v1/invoice/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved_by: "tamper" })
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json() as any).data;
    expect(patched.approved_by == null).toBe(true);

    await lumora.close();
  });
});
