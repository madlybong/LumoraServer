import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";
import { SQL } from "bun";

async function createFixtureApp(auditValue: string = "false") {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-audit-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  
  const uid = crypto.randomUUID().replace(/-/g, "");
  await writeFile(
    path.join(routesDir, `post_${uid}.ts`),
    `export default {
  kind: "resource",
  resource: "post",
  fields: {
    title: { type: "string", required: true }
  },
  audit: ${auditValue}
};`
  );

  const dbPath = path.join(root, "test.db");

  const lumora = await initLumora({
    name: "fixture",
    mode: "production",
    api: { base: "/api", version: "v1" },
    auth: { mode: "static", token: "secret" },
    database: { client: "sqlite", url: `sqlite://${dbPath}` },
    routes: { dir: routesDir }
  });

  return { root, lumora, dbPath };
}

async function queryAuditLogs(dbPath: string) {
  const sql = new SQL(`sqlite://${dbPath}`);
  await sql.connect();
  const rows = await sql.unsafe("SELECT * FROM `_audit_logs` ORDER BY timestamp ASC");
  await sql.close();
  return rows;
}

describe("Audit Trail", () => {
  test("audit: false (default) -> no rows in _audit_logs", async () => {
    const { lumora, dbPath } = await createFixtureApp("false");
    
    await lumora.app.request("/api/v1/post", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer secret" },
      body: JSON.stringify({ title: "Hello" })
    });
    
    const rows = await queryAuditLogs(dbPath);
    expect(rows.length).toBe(0);

    await lumora.close();
  });

  test("audit: true -> POST creates row", async () => {
    const { lumora, dbPath } = await createFixtureApp("true");
    
    const res = await lumora.app.request("/api/v1/post", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer secret" },
      body: JSON.stringify({ title: "Audit me" })
    });
    if (!res.ok) throw new Error(await res.text());
    const created = await res.json() as any;
    
    const rows = await queryAuditLogs(dbPath);
    expect(rows.length).toBe(1);
    const log = rows[0] as any;
    expect(log.action).toBe("create");
    expect(log.resource).toBe("post");
    expect(log.record_id).toBe(created.data.id);
    expect(log.actor_subject).toBe("static-token");
    expect(log.old_value).toBe("{}");
    expect(JSON.parse(log.new_value).title).toBe("Audit me");

    await lumora.close();
  });

  test("audit: true -> PUT creates row", async () => {
    const { lumora, dbPath } = await createFixtureApp("true");
    
    const postRes = await lumora.app.request("/api/v1/post", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer secret" },
      body: JSON.stringify({ title: "Audit me" })
    });
    const created = await postRes.json() as any;

    await lumora.app.request(`/api/v1/post/${created.data.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "authorization": "Bearer secret" },
      body: JSON.stringify({ title: "Updated title" })
    });
    
    const rows = await queryAuditLogs(dbPath);
    expect(rows.length).toBe(2);
    
    const log = rows[1] as any; // second row is the PUT
    expect(log.action).toBe("update");
    expect(JSON.parse(log.old_value).title).toBe("Audit me");
    expect(JSON.parse(log.new_value).title).toBe("Updated title");

    await lumora.close();
  });

  test("audit: true -> DELETE creates row", async () => {
    const { lumora, dbPath } = await createFixtureApp("true");
    
    const postRes = await lumora.app.request("/api/v1/post", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer secret" },
      body: JSON.stringify({ title: "Delete me" })
    });
    const created = await postRes.json() as any;

    await lumora.app.request(`/api/v1/post/${created.data.id}`, {
      method: "DELETE",
      headers: { "authorization": "Bearer secret" }
    });
    
    const rows = await queryAuditLogs(dbPath);
    expect(rows.length).toBe(2);
    
    const log = rows[1] as any; // second row is the DELETE
    expect(log.action).toBe("delete");
    expect(JSON.parse(log.old_value).title).toBe("Delete me");
    expect(log.new_value).toBe("{}");

    await lumora.close();
  });
});
