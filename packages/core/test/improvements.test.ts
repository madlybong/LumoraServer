import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { initLumora, defineLumoraConfig, defineResource } from "../src";
import type { LumoraInstance } from "../src/types";

describe("Lumora Improvements", () => {
  let lumora: LumoraInstance;

  beforeAll(async () => {
    const TestResource = defineResource({
      resource: "test_resource",
      fields: {
        name: { type: "string", filterable: true },
        email: { type: "string", unique: true, filterable: true }
      }
    });

    const config = defineLumoraConfig({
      api: { base: "api", version: "v1" },
      mode: "test",
      name: "lumora-improvements",
      database: { client: "sqlite", url: ":memory:" },
      auth: { mode: "disabled" },
      realtime: {},
      resources: [TestResource]
    });

    lumora = await initLumora(config);
    
    // Seed
    await lumora.database.create(TestResource, { name: "Alice", email: "alice@example.com" });
    await lumora.database.create(TestResource, { name: "Bob", email: "bob@example.com" });
  });

  afterAll(async () => {
    await lumora.close();
  });

  it("ilike filter operator", async () => {
    const req = new Request("http://localhost/api/v1/test_resource?email__ilike=ALICE%25");
    const res = await lumora.fetch(req);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Alice");
  });

  it("409 Conflict on unique violation", async () => {
    const req = new Request("http://localhost/api/v1/test_resource", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice Duplicate", email: "alice@example.com" })
    });
    const res = await lumora.fetch(req);
    const body = await res.json() as any;
    if (res.status !== 409) {
      console.log("500 Error Body:", body);
    }
    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Duplicate value for unique field");
  });

  it("Cursor pagination", async () => {
    const req1 = new Request("http://localhost/api/v1/test_resource?pageSize=1&sort=id");
    const res1 = await lumora.fetch(req1);
    const body1 = await res1.json() as any;
    expect(body1.data.length).toBe(1);
    const cursor = body1.nextCursor;
    expect(cursor).toBeDefined();

    const req2 = new Request(`http://localhost/api/v1/test_resource?pageSize=1&sort=id&cursor=${cursor}`);
    const res2 = await lumora.fetch(req2);
    const body2 = await res2.json() as any;
    expect(body2.data.length).toBe(1);
    expect(body2.data[0].id).not.toBe(body1.data[0].id);
  });

  it("Bulk update", async () => {
    // Get Bob's ID
    const req = new Request("http://localhost/api/v1/test_resource?name=Bob");
    const res = await lumora.fetch(req);
    const body = await res.json() as any;
    const bobId = body.data[0].id;

    // Update via bulk
    const updateReq = new Request("http://localhost/api/v1/test_resource/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "update",
        records: [{ id: bobId, name: "Bob Updated" }]
      })
    });
    const updateRes = await lumora.fetch(updateReq);
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json() as any;
    expect(updateBody.ok).toBe(true);
    expect(updateBody.results[0].success).toBe(true);
    expect(updateBody.results[0].data.id).toBe(bobId);
    
    // Fetch it again to verify update
    const verifyReq = new Request(`http://localhost/api/v1/test_resource/${bobId}`);
    const verifyRes = await lumora.fetch(verifyReq);
    const verifyBody = await verifyRes.json() as any;
    expect(verifyBody.data.name).toBe("Bob Updated");
  });
});
