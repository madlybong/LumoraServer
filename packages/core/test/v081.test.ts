import { describe, expect, test } from "bun:test";
import { initLumora } from "../src/runtime";

describe("v0.8.1 Features", () => {
  test("Pagination Metadata (totalPages, hasNextPage)", async () => {
    const lumora = await initLumora({
      api: { base: 'api', version: 'v1' }, name: 'test', mode: 'test', database: { client: "sqlite", url: ":memory:" },
      cors: { origin: "*" },
      auth: { mode: "disabled" },
      logging: { level: "silent" },
      rateLimit: { enabled: false, max: 100, windowMs: 1000, store: "memory" },
      resources: [
        { kind: 'resource', resource: "book",
          fields: { title: { type: "string", filterable: true } },
          query: { defaultPageSize: 2 }
        }
      ]
    });
    
    // Seed 5 books
    for(let i=0; i<5; i++) {
      await lumora.fetch(new Request("http://localhost/api/v1/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Book ${i}` })
      }));
    }

    const res = await lumora.fetch(new Request("http://localhost/api/v1/book?page=1"));
    const data = await res.json() as any;
    
    expect(data.ok).toBe(true);
    expect(data.pageSize).toBe(2);
    expect(data.total).toBe(5);
    expect(data.totalPages).toBe(3);
    expect(data.hasNextPage).toBe(true);

    const res2 = await lumora.fetch(new Request("http://localhost/api/v1/book?page=3"));
    const data2 = await res2.json() as any;
    expect(data2.hasNextPage).toBe(false);

    await lumora.close();
  });

  test("Filter Operators", async () => {
    const lumora = await initLumora({
      api: { base: 'api', version: 'v1' }, name: 'test', mode: 'test', database: { client: "sqlite", url: ":memory:" },
      cors: { origin: "*" },
      auth: { mode: "disabled" },
      logging: { level: "silent" },
      rateLimit: { enabled: false, max: 100, windowMs: 1000, store: "memory" },
      resources: [
        { kind: 'resource', resource: "person",
          fields: { age: { type: "number", filterable: true } }
        }
      ]
    });

    await lumora.fetch(new Request("http://localhost/api/v1/person", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ age: 10 })
    }));
    await lumora.fetch(new Request("http://localhost/api/v1/person", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ age: 20 })
    }));
    await lumora.fetch(new Request("http://localhost/api/v1/person", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ age: 30 })
    }));

    const resGt = await lumora.fetch(new Request("http://localhost/api/v1/person?age__gt=15"));
    const dataGt = await resGt.json() as any;
    expect(dataGt.data.length).toBe(2);

    const resIn = await lumora.fetch(new Request("http://localhost/api/v1/person?age__in=10,30"));
    const dataIn = await resIn.json() as any;
    expect(dataIn.data.length).toBe(2);
    
    await lumora.close();
  });

  test("Rate Limit Overrides", async () => {
    const lumora = await initLumora({
      api: { base: 'api', version: 'v1' }, name: 'test', mode: 'test', database: { client: "sqlite", url: ":memory:" },
      cors: { origin: "*" },
      auth: { mode: "disabled" },
      logging: { level: "silent" },
      rateLimit: { enabled: true, max: 2, windowMs: 1000, store: "memory" },
      resources: [
        { kind: 'resource', resource: "limited",
          fields: { name: { type: "string" } }
        },
        { kind: 'resource', resource: "unlimited",
          fields: { name: { type: "string" } },
          rateLimit: { disabled: true }
        }
      ]
    });

    // Limited route
    await lumora.fetch(new Request("http://localhost/api/v1/limited"));
    await lumora.fetch(new Request("http://localhost/api/v1/limited"));
    const resLimited = await lumora.fetch(new Request("http://localhost/api/v1/limited"));
    expect(resLimited.status).toBe(429); // 3rd request fails

    // Unlimited route
    await lumora.fetch(new Request("http://localhost/api/v1/unlimited"));
    await lumora.fetch(new Request("http://localhost/api/v1/unlimited"));
    const resUnlimited = await lumora.fetch(new Request("http://localhost/api/v1/unlimited"));
    expect(resUnlimited.status).toBe(200); // 3rd request succeeds

    await lumora.close();
  });

  test("CSV maxRows", async () => {
    const lumora = await initLumora({
      api: { base: 'api', version: 'v1' }, name: 'test', mode: 'test', database: { client: "sqlite", url: ":memory:" },
      cors: { origin: "*" },
      auth: { mode: "disabled" },
      logging: { level: "silent" },
      rateLimit: { enabled: false, max: 100, windowMs: 1000, store: "memory" },
      resources: [
        { kind: 'resource', resource: "item",
          fields: { val: { type: "number" } },
          export: { csv: { maxRows: 2 } } // Export only 2 rows
        }
      ]
    });

    for(let i=0; i<5; i++) {
      await lumora.fetch(new Request("http://localhost/api/v1/item", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ val: i })
      }));
    }

    const res = await lumora.fetch(new Request("http://localhost/api/v1/item/export/csv"));
    const text = await res.text();
    const lines = text.trim().split("\n");
    // header + 2 rows = 3 lines
    expect(lines.length).toBe(3);

    await lumora.close();
  });

  test('Audit before/after and actorStrategy', async () => {
    const lumora = await initLumora({
      api: { base: 'api', version: 'v1' }, name: 'test', mode: 'test', database: { client: 'sqlite', url: ':memory:' },
      cors: { origin: '*' }, auth: { mode: 'disabled' }, logging: { level: 'silent' },
      rateLimit: { enabled: false, max: 100, windowMs: 1000, store: 'memory' },
      resources: [{ kind: 'resource', resource: 'audited_item', audit: true, fields: { val: { type: 'string' } } }]
    });
    const res = await lumora.fetch(new Request('http://localhost/api/v1/audited_item', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ val: 'test' })
    }));
    const data = await res.json();
    const logs = await lumora.database.sql`SELECT * FROM _audit_logs`;
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('create');
    const newValue = JSON.parse(logs[0].new_value);
    expect(newValue.val).toBe('test');
    await lumora.close();
  });
});
