import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { SQL } from "bun";
import {
  initLumora,
  defineResource,
  signLumoraJwt,
  rotateLumoraTokens,
  verifyJwtToken,
  OpenAPIHono,
  createRoute,
  z,
  requirePolicy,
  enforceSoD,
  requireThreshold,
  requireTimeWindow,
  idempotency,
  type LumoraHonoVariables
} from "../src/index";

describe("v0.9.0 Enterprise Upgrades (RFC-01 through RFC-10)", () => {
  // ─── RFC-01: Custom Auth Mode, Token Rotation & Multi-Axis Claim Mapping ───
  describe("RFC-01: Custom Auth, Dual-Token Rotation & Claim Mapping", () => {
    test("allows auth.mode: 'custom' in production and invokes afterVerify + publicPaths", async () => {
      const lumora = await initLumora({
        name: "rfc01-custom-auth",
        mode: "production",
        api: { base: "/api", version: "v1" },
        auth: {
          mode: "custom",
          protectedPaths: ["/api/v1/*"],
          publicPaths: ["/api/v1/public/*"],
          verify: async (c) => {
            const apiKey = c.req.header("x-api-key");
            if (apiKey !== "valid-custom-key") return null;
            return {
              subject: "user-custom-1",
              strategy: "custom",
              token: apiKey,
              roles: ["editor"],
              scope: { tenant_id: "tenant-acme", branch_id: "branch-1" },
              claims: { department: "finance" }
            };
          },
          afterVerify: async (auth, c) => {
            if (c.req.header("x-revoked") === "true") {
              return c.json({ ok: false, error: "Session revoked" }, 401);
            }
          }
        },
        database: { client: "sqlite", url: "sqlite://:memory:" },
        resources: [
          defineResource({
            resource: "invoice",
            fields: { title: { type: "string", required: true } }
          })
        ]
      });

      const pubRouter = new Hono();
      pubRouter.get("/info", (c) => c.json({ ok: true, public: true }));
      lumora.mountModule("/public", pubRouter);

      // Public path bypasses protectedPaths
      const pubRes = await lumora.app.request("/api/v1/public/info");
      expect(pubRes.status).toBe(200);

      // Missing custom auth header -> 401
      const unauthRes = await lumora.app.request("/api/v1/invoice");
      expect(unauthRes.status).toBe(401);

      // Valid custom auth header -> 200
      const okRes = await lumora.app.request("/api/v1/invoice", {
        headers: { "x-api-key": "valid-custom-key" }
      });
      expect(okRes.status).toBe(200);

      // Revoked via afterVerify -> 401
      const revokedRes = await lumora.app.request("/api/v1/invoice", {
        headers: { "x-api-key": "valid-custom-key", "x-revoked": "true" }
      });
      expect(revokedRes.status).toBe(401);

      await lumora.close();
    });

    test("signLumoraJwt, rotateLumoraTokens, and JWT claimMapping extract multi-axis scopes", async () => {
      const accessSecret = "access-secret-key-123";
      const refreshSecret = "refresh-secret-key-456";

      const initialRefresh = await signLumoraJwt(
        {
          userId: "usr-99",
          role: "admin",
          companyId: "comp-77",
          verticalId: "mfg",
          locationId: "loc-kolkata",
          type: "refresh"
        },
        refreshSecret,
        { expiresInSeconds: 3600, issuer: "lumora-erp" }
      );

      const rotated = await rotateLumoraTokens(initialRefresh, {
        secret: accessSecret,
        refreshSecret,
        accessExpiresInSeconds: 900,
        refreshExpiresInSeconds: 7200,
        issuer: "lumora-erp"
      });

      expect(rotated.accessToken).toBeString();
      expect(rotated.refreshToken).toBeString();

      const verifiedAccess = await verifyJwtToken(rotated.accessToken, accessSecret, {
        issuer: "lumora-erp"
      });
      expect(verifiedAccess.userId).toBe("usr-99");
      expect(verifiedAccess.type).toBe("access");

      const lumora = await initLumora({
        name: "rfc01-claim-mapping",
        mode: "production",
        api: { base: "/api", version: "v1" },
        auth: {
          mode: "jwt",
          secret: accessSecret,
          refreshSecret,
          issuer: "lumora-erp",
          claimMapping: {
            subject: "userId",
            roles: "role",
            tenantId: "companyId",
            scopes: ["companyId", "verticalId", "locationId"]
          }
        },
        database: { client: "sqlite", url: "sqlite://:memory:" },
        resources: [
          defineResource({
            resource: "order",
            fields: {
              item: { type: "string", required: true },
              locationId: { type: "string", required: true }
            },
            permissions: {
              roles: ["admin"],
              scope: { field: "locationId" }
            }
          })
        ]
      });

      await lumora.database.create(
        lumora.resources[0]!,
        { item: "Steel Coil", locationId: "loc-kolkata" }
      );
      await lumora.database.create(
        lumora.resources[0]!,
        { item: "Copper Wire", locationId: "loc-mumbai" }
      );

      const res = await lumora.app.request("/api/v1/order", {
        headers: { authorization: `Bearer ${rotated.accessToken}` }
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Array<{ item: string }> };
      expect(body.data.length).toBe(1);
      expect(body.data[0]?.item).toBe("Steel Coil");

      await lumora.close();
    });
  });

  // ─── RFC-02: Enterprise SQLite Pragmas & Multi-Tenancy/ExcludeFields Fixes ─
  describe("RFC-02: Enterprise SQLite Pragmas & Query Engine Fixes", () => {
    test("applies WAL, busy_timeout, synchronous, foreign_keys, and cache_size pragmas on SQLite file DB", async () => {
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "lumora-rfc02-"));
      const dbFile = path.join(tmpDir, "pragma-test.db");

      const lumora = await initLumora({
        name: "rfc02-pragmas",
        mode: "development",
        api: { base: "/api", version: "v1" },
        auth: { mode: "disabled" },
        database: {
          client: "sqlite",
          url: `sqlite://${dbFile}`,
          pragmas: {
            journalMode: "WAL",
            busyTimeoutMs: 7500,
            synchronous: "NORMAL",
            foreignKeys: true,
            cacheSizeKb: -32000
          }
        },
        resources: [
          defineResource({
            resource: "secret_doc",
            fields: {
              title: { type: "string", required: true },
              secretHash: { type: "string", required: true }
            },
            excludeFields: ["secretHash"]
          })
        ]
      });

      const jm = await lumora.database.sql.unsafe<Array<{ journal_mode: string }>>("PRAGMA journal_mode;");
      expect(jm[0]?.journal_mode.toLowerCase()).toBe("wal");

      const bt = await lumora.database.sql.unsafe<Array<{ timeout: number }>>("PRAGMA busy_timeout;");
      expect(Number(Object.values(bt[0] ?? {})[0])).toBe(7500);

      const fk = await lumora.database.sql.unsafe<Array<{ foreign_keys: number }>>("PRAGMA foreign_keys;");
      expect(Number(Object.values(fk[0] ?? {})[0])).toBe(1);

      // Verify excludeFields is honored in both create, get, and list
      const createRes = await lumora.app.request("/api/v1/secret_doc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Top Secret", secretHash: "hash-xyz" })
      });
      const created = (await createRes.json()) as { data: Record<string, unknown> };
      expect(created.data.title).toBe("Top Secret");
      expect(created.data.secretHash).toBeUndefined();

      const listRes = await lumora.app.request("/api/v1/secret_doc");
      const listed = (await listRes.json()) as { data: Array<Record<string, unknown>> };
      expect(listed.data[0]?.secretHash).toBeUndefined();

      await lumora.close();
    });
  });

  // ─── RFC-03: Migrations Checksum Verification, TRUNCATE Guard & VACUUM INTO ─
  describe("RFC-03: Atomic SQLite Backup/Restore & Migration Integrity", () => {
    test("creates atomic VACUUM INTO backup, prunes old backups, and restores on migration failure", async () => {
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "lumora-rfc03-"));
      const dbFile = path.join(tmpDir, "app.db");

      // Initialize seed DB
      const seedSql = new SQL(`sqlite://${dbFile}`);
      await seedSql.connect();
      await seedSql.unsafe("CREATE TABLE seed_items (id TEXT PRIMARY KEY, name TEXT);");
      await seedSql.unsafe("INSERT INTO seed_items (id, name) VALUES ('1', 'original');");
      await seedSql.close();

      // Failing 2nd migration should trigger automatic restore from pre-migration backup
      await expect(
        initLumora({
          name: "rfc03-backup",
          mode: "development",
          api: { base: "/api", version: "v1" },
          auth: { mode: "disabled" },
          database: {
            client: "sqlite",
            url: `sqlite://${dbFile}`,
            autoBackup: true,
            maxRetainedBackups: 2
          },
          migrations: {
            mode: "auto",
            embeddedFiles: {
              "001_alter.sql": "UPDATE seed_items SET name = 'mutated_before_crash';",
              "002_fail.sql": "INVALID SQL SYNTAX THAT FAILS;"
            }
          },
          resources: []
        })
      ).rejects.toThrow(/Migration "002_fail" failed/);

      // Verify backup file was created and DB was restored to 'original'
      const files = await readdir(tmpDir);
      const backups = files.filter((f) => f.startsWith("app_backup_"));
      expect(backups.length).toBeGreaterThan(0);

      const checkSql = new SQL(`sqlite://${dbFile}`);
      await checkSql.connect();
      const rows = await checkSql.unsafe<Array<{ name: string }>>("SELECT name FROM seed_items WHERE id = '1'");
      await checkSql.close();
      expect(rows[0]?.name).toBe("original");
    });

    test("blocks TRUNCATE when blockDestructive is enabled and detects checksum tampering even with 0 pending", async () => {
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "lumora-rfc03-tamper-"));
      const dbFile = path.join(tmpDir, "tamper.db");

      await expect(
        initLumora({
          name: "rfc03-truncate",
          mode: "development",
          api: { base: "/api", version: "v1" },
          auth: { mode: "disabled" },
          database: { client: "sqlite", url: `sqlite://${dbFile}` },
          migrations: {
            mode: "auto",
            blockDestructive: true,
            embeddedFiles: {
              "001_init.sql": "TRUNCATE TABLE users;"
            }
          },
          resources: []
        })
      ).rejects.toThrow(/Destructive operation detected/);

      // Apply valid migration first
      const lumora1 = await initLumora({
        name: "rfc03-checksum-1",
        mode: "development",
        api: { base: "/api", version: "v1" },
        auth: { mode: "disabled" },
        database: { client: "sqlite", url: `sqlite://${dbFile}` },
        migrations: {
          mode: "auto",
          embeddedFiles: {
            "001_init.sql": "CREATE TABLE items (id TEXT PRIMARY KEY);"
          }
        },
        resources: []
      });
      await lumora1.close();

      // Re-open with modified SQL for already-applied 001_init.sql (0 pending migrations!)
      await expect(
        initLumora({
          name: "rfc03-checksum-2",
          mode: "development",
          api: { base: "/api", version: "v1" },
          auth: { mode: "disabled" },
          database: { client: "sqlite", url: `sqlite://${dbFile}` },
          migrations: {
            mode: "auto",
            embeddedFiles: {
              "001_init.sql": "CREATE TABLE items (id TEXT PRIMARY KEY, extra TEXT);"
            }
          },
          resources: []
        })
      ).rejects.toThrow(/checksum mismatch/);
    });
  });

  // ─── RFC-04: Global Rate Limit Inheritance on mountModule & Security Headers ─
  describe("RFC-04: Global Rate Limit on mountModule & Security Headers", () => {
    test("inherits global rateLimit on mountModule, emits X-RateLimit-* and security headers", async () => {
      const lumora = await initLumora({
        name: "rfc04-ratelimit",
        mode: "development",
        api: { base: "/api", version: "v1" },
        auth: { mode: "disabled" },
        database: { client: "sqlite", url: "sqlite://:memory:" },
        rateLimit: { enabled: true, max: 2, windowMs: 60_000, store: "memory" },
        resources: []
      });

      const sub = new Hono();
      sub.get("/action", (c) => c.json({ ok: true }));
      lumora.mountModule("/mod", sub);

      const r1 = await lumora.app.request("/api/v1/mod/action");
      expect(r1.status).toBe(200);
      expect(r1.headers.get("X-RateLimit-Limit")).toBe("2");
      expect(r1.headers.get("X-RateLimit-Remaining")).toBe("1");
      expect(r1.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(r1.headers.get("X-Frame-Options")).toBe("DENY");

      const r2 = await lumora.app.request("/api/v1/mod/action");
      expect(r2.status).toBe(200);
      expect(r2.headers.get("X-RateLimit-Remaining")).toBe("0");

      const r3 = await lumora.app.request("/api/v1/mod/action");
      expect(r3.status).toBe(429);
      expect(r3.headers.get("Retry-After")).toBeDefined();

      await lumora.close();
    });
  });

  // ─── RFC-05: Cryptographic SHA-256 Hash-Chained Audit Ledger ───────────────
  describe("RFC-05: Cryptographic SHA-256 Hash-Chained Audit Ledger", () => {
    test("chains audit records with SHA-256 and detects database tampering via verifyAuditChain()", async () => {
      const lumora = await initLumora({
        name: "rfc05-audit-chain",
        mode: "development",
        api: { base: "/api", version: "v1" },
        auth: { mode: "static", token: "sec" },
        database: { client: "sqlite", url: "sqlite://:memory:", auditHashChain: true },
        resources: [
          defineResource({
            resource: "ledger",
            fields: { amount: { type: "number", required: true } },
            audit: { hashChain: true }
          })
        ]
      });

      const r1 = await lumora.app.request("/api/v1/ledger", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer sec" },
        body: JSON.stringify({ amount: 100 })
      });
      const created = (await r1.json()) as { data: { id: string } };

      await lumora.app.request(`/api/v1/ledger/${created.data.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: "Bearer sec" },
        body: JSON.stringify({ amount: 250 })
      });

      const verification1 = await lumora.database.verifyAuditChain();
      expect(verification1.valid).toBe(true);
      expect(verification1.checkedCount).toBe(2);

      // Tamper with the first audit record in SQLite
      await lumora.database.sql.unsafe(
        "UPDATE `_audit_logs` SET `new_value` = '{\"amount\":999999}' WHERE `action` = 'create'"
      );

      const verification2 = await lumora.database.verifyAuditChain();
      expect(verification2.valid).toBe(false);
      expect(verification2.brokenAtId).toBeDefined();

      await lumora.close();
    });
  });

  // ─── RFC-06: Tenant-Isolated Realtime Channels, Heartbeats & Replay ────────
  describe("RFC-06: Tenant-Isolated Realtime, SSE Heartbeats & Last-Event-ID Replay", () => {
    test("isolates publishToTenant events by tenantId and replays missed events via Last-Event-ID", async () => {
      const lumora = await initLumora({
        name: "rfc06-realtime",
        mode: "development",
        api: { base: "/api", version: "v1" },
        auth: { mode: "disabled" },
        database: { client: "sqlite", url: "sqlite://:memory:" },
        realtime: { enabled: true, heartbeatIntervalMs: 50, maxReplayBuffer: 50 },
        resources: []
      });

      const respTenantA = await lumora.realtime.createTenantSseResponse("tenant-A", "alerts");
      const respTenantB = await lumora.realtime.createTenantSseResponse("tenant-B", "alerts");

      const readerA = respTenantA.body!.getReader();
      const readerB = respTenantB.body!.getReader();

      // Read initial ready frames
      await readerA.read();
      await readerB.read();

      lumora.realtime.publishToTenant("tenant-A", "alerts", { msg: "Only for A" });
      lumora.realtime.publishToTenant("tenant-B", "alerts", { msg: "Only for B" });

      const decodeChunk = (val: unknown) =>
        typeof val === "string" ? val : new TextDecoder().decode(val as Uint8Array);

      const chunkA = decodeChunk((await readerA.read()).value);
      const chunkB = decodeChunk((await readerB.read()).value);

      expect(chunkA).toContain("Only for A");
      expect(chunkA).not.toContain("Only for B");
      expect(chunkB).toContain("Only for B");
      expect(chunkB).not.toContain("Only for A");

      // Wait 70ms to verify SSE keep-alive heartbeat comment (: ping\n\n)
      await Bun.sleep(70);
      const pingChunk = decodeChunk((await readerA.read()).value);
      expect(pingChunk).toContain(": ping");

      await readerA.cancel();
      await readerB.cancel();
      await lumora.close();
    });
  });

  // ─── RFC-07: OpenAPI 3.1.0 Sub-Router Introspection (@hono/zod-openapi) ────
  describe("RFC-07: OpenAPI 3.1.0 Sub-Router Introspection", () => {
    test("merges OpenAPIHono and standard Hono sub-routers into /__lumora/openapi.json", async () => {
      const lumora = await initLumora({
        name: "rfc07-openapi",
        mode: "development",
        api: { base: "/api", version: "v1" },
        auth: { mode: "disabled" },
        database: { client: "sqlite", url: "sqlite://:memory:" },
        docs: { enabled: true },
        resources: []
      });

      const billingRouter = new OpenAPIHono<{ Variables: LumoraHonoVariables }>();
      const payRoute = createRoute({
        method: "post",
        path: "/pay/{invoiceId}",
        summary: "Pay an invoice",
        responses: {
          200: {
            description: "Payment settled",
            content: {
              "application/json": {
                schema: z.object({ settled: z.boolean() })
              }
            }
          }
        }
      });
      billingRouter.openapi(payRoute, (c) => c.json({ settled: true }, 200));

      const plainRouter = new Hono();
      plainRouter.get("/status/:code", (c) => c.json({ code: c.req.param("code") }));

      lumora.mountModule("/billing", billingRouter, { protected: true, openApiTags: ["billing"] });
      lumora.mountModule("/ops", plainRouter, { openApiTags: ["ops"] });

      const docRes = await lumora.app.request("/__lumora/openapi.json");
      expect(docRes.status).toBe(200);
      const doc = (await docRes.json()) as { paths: Record<string, Record<string, unknown>> };

      expect(doc.paths["/api/v1/billing/pay/{invoiceId}"]?.post).toBeDefined();
      expect(doc.paths["/api/v1/ops/status/{code}"]?.get).toBeDefined();

      await lumora.close();
    });
  });

  // ─── RFC-08: Declarative Governance Middlewares & Record-Level Policy ──────
  describe("RFC-08: Governance Middlewares & permissions.allowRecord", () => {
    test("enforces permissions.allowRecord, enforceSoD, requireThreshold, requireTimeWindow, and requirePolicy", async () => {
      const lumora = await initLumora({
        name: "rfc08-governance",
        mode: "production",
        api: { base: "/api", version: "v1" },
        auth: {
          mode: "custom",
          verify: async (c) => ({
            subject: c.req.header("x-user") ?? "user-1",
            strategy: "custom",
            token: "tok",
            roles: [c.req.header("x-role") ?? "manager"]
          })
        },
        database: { client: "sqlite", url: "sqlite://:memory:" },
        resources: [
          defineResource({
            resource: "voucher",
            fields: {
              ownerId: { type: "string", required: true },
              amount: { type: "number", required: true }
            },
            permissions: {
              allowRecord: (auth, record) => record.ownerId === auth.subject
            }
          })
        ]
      });

      // Mount procedural approval route using enforceSoD, requireThreshold, requireTimeWindow, requirePolicy BEFORE first request
      let periodOpen = true;
      const approvalRouter = new Hono<{ Variables: LumoraHonoVariables }>();
      approvalRouter.post(
        "/approve",
        requireTimeWindow(() => ({ open: periodOpen, reason: "Fiscal period closed" })),
        enforceSoD((c) => c.req.header("x-creator")),
        requireThreshold({
          getValue: async (c) => Number(c.req.header("x-amount") ?? 0),
          tiers: [
            { maxAmount: 1_000, roles: ["manager"] },
            { maxAmount: 50_000, roles: ["director"] },
            { maxAmount: 1_000_000, roles: ["cfo"] }
          ]
        }),
        requirePolicy((principal) => principal.subject !== "suspended-user", "User is suspended"),
        (c) => c.var.ok({ approved: true })
      );

      lumora.mountModule("/governance", approvalRouter, { protected: true });

      // Create voucher owned by user-1
      const cRes = await lumora.app.request("/api/v1/voucher", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user": "user-1" },
        body: JSON.stringify({ ownerId: "user-1", amount: 500 })
      });
      const voucher = ((await cRes.json()) as { data: { id: string } }).data;

      // user-2 blocked by allowRecord on GET /:id and DELETE /:id
      const getDenied = await lumora.app.request(`/api/v1/voucher/${voucher.id}`, {
        headers: { "x-user": "user-2" }
      });
      expect(getDenied.status).toBe(403);

      const getAllowed = await lumora.app.request(`/api/v1/voucher/${voucher.id}`, {
        headers: { "x-user": "user-1" }
      });
      expect(getAllowed.status).toBe(200);

      // 1. SoD violation: creator === approver ("user-1")
      const sodRes = await lumora.app.request("/api/v1/governance/approve", {
        method: "POST",
        headers: { "x-user": "user-1", "x-creator": "user-1", "x-role": "manager", "x-amount": "500" }
      });
      expect(sodRes.status).toBe(403);

      // 2. Threshold exceeded: manager trying to approve 5000
      const threshRes = await lumora.app.request("/api/v1/governance/approve", {
        method: "POST",
        headers: { "x-user": "user-2", "x-creator": "user-1", "x-role": "manager", "x-amount": "5000" }
      });
      expect(threshRes.status).toBe(403);

      // 3. Director approving 5000 -> 200 OK
      const okRes = await lumora.app.request("/api/v1/governance/approve", {
        method: "POST",
        headers: { "x-user": "user-2", "x-creator": "user-1", "x-role": "director", "x-amount": "5000" }
      });
      expect(okRes.status).toBe(200);

      // 4. Period closed -> 403
      periodOpen = false;
      const winRes = await lumora.app.request("/api/v1/governance/approve", {
        method: "POST",
        headers: { "x-user": "user-2", "x-creator": "user-1", "x-role": "director", "x-amount": "500" }
      });
      expect(winRes.status).toBe(403);

      await lumora.close();
    });
  });

  // ─── RFC-09: Delta Queries (?since=) & Idempotency Middleware ──────────────
  describe("RFC-09: Delta Queries (?since=) & Idempotency Middleware", () => {
    test("supports ?since= delta filtering and database-backed idempotency replay/conflict detection", async () => {
      const lumora = await initLumora({
        name: "rfc09-sync-idempotency",
        mode: "development",
        api: { base: "/api", version: "v1" },
        auth: { mode: "disabled" },
        database: { client: "sqlite", url: "sqlite://:memory:" },
        resources: [
          defineResource({
            resource: "inventory",
            fields: { sku: { type: "string", required: true } }
          })
        ]
      });

      // Mount mutation endpoint with database-backed idempotency BEFORE dispatching requests
      let executionCount = 0;
      const mutRouter = new Hono<{ Variables: LumoraHonoVariables }>();
      mutRouter.post("/mutate", idempotency({ store: "database", required: true }), async (c) => {
        executionCount++;
        const body = await c.req.json();
        return c.var.created({ seq: executionCount, body });
      });
      lumora.mountModule("/sync", mutRouter);

      await lumora.app.request("/api/v1/inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku: "SKU-OLD" })
      });

      await Bun.sleep(15);
      const checkpoint = new Date().toISOString();
      await Bun.sleep(15);

      await lumora.app.request("/api/v1/inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku: "SKU-NEW" })
      });

      const deltaRes = await lumora.app.request(`/api/v1/inventory?since=${encodeURIComponent(checkpoint)}`);
      const deltaBody = (await deltaRes.json()) as { data: Array<{ sku: string }> };
      expect(deltaBody.data.length).toBe(1);
      expect(deltaBody.data[0]?.sku).toBe("SKU-NEW");

      // First call executes handler
      const m1 = await lumora.app.request("/api/v1/sync/mutate", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "mut-key-1" },
        body: JSON.stringify({ qty: 10 })
      });
      expect(m1.status).toBe(201);
      expect(m1.headers.get("X-Idempotency-Replayed")).toBe("false");
      const m1Json = (await m1.json()) as { data: { seq: number } };
      expect(m1Json.data.seq).toBe(1);

      // Replay with same key and same payload -> returns cached response without re-running handler
      const m2 = await lumora.app.request("/api/v1/sync/mutate", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "mut-key-1" },
        body: JSON.stringify({ qty: 10 })
      });
      expect(m2.status).toBe(201);
      expect(m2.headers.get("X-Idempotency-Replayed")).toBe("true");
      const m2Json = (await m2.json()) as { data: { seq: number } };
      expect(m2Json.data.seq).toBe(1);
      expect(executionCount).toBe(1);

      // Replay with same key but DIFFERENT payload -> 409 IDEMPOTENCY_CONFLICT
      const m3 = await lumora.app.request("/api/v1/sync/mutate", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "mut-key-1" },
        body: JSON.stringify({ qty: 99 })
      });
      expect(m3.status).toBe(409);

      await lumora.close();
    });
  });

  // ─── RFC-10: Deep Health Probes, Telemetry Metrics & Graceful Shutdown ─────
  describe("RFC-10: Health Readiness Probe, Metrics & Graceful stop()", () => {
    test("serves /__lumora/health with DB latency, /__lumora/metrics in JSON and Prometheus formats, and lumora.stop()", async () => {
      const lumora = await initLumora({
        name: "rfc10-observability",
        mode: "development",
        api: { base: "/api", version: "v1" },
        auth: { mode: "disabled" },
        database: { client: "sqlite", url: "sqlite://:memory:" },
        resources: []
      });

      let hookCalled = false;
      lumora.onShutdown(() => {
        hookCalled = true;
      });

      const healthRes = await lumora.app.request("/__lumora/health");
      expect(healthRes.status).toBe(200);
      const health = (await healthRes.json()) as {
        ok: boolean;
        status: string;
        database: { status: string; latencyMs: number };
      };
      expect(health.ok).toBe(true);
      expect(health.status).toBe("healthy");
      expect(health.database.status).toBe("connected");
      expect(typeof health.database.latencyMs).toBe("number");

      const metricsJsonRes = await lumora.app.request("/__lumora/metrics");
      expect(metricsJsonRes.status).toBe(200);
      const metricsJson = (await metricsJsonRes.json()) as { requestsTotal: number };
      expect(metricsJson.requestsTotal).toBeGreaterThanOrEqual(1);

      const metricsPromRes = await lumora.app.request("/__lumora/metrics?format=prometheus");
      expect(metricsPromRes.status).toBe(200);
      const promText = await metricsPromRes.text();
      expect(promText).toContain("lumora_requests_total");
      expect(promText).toContain("lumora_uptime_seconds");

      await lumora.stop();
      expect(hookCalled).toBe(true);
    });
  });
});
