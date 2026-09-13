import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import type { LumoraConfig } from "../src/types";
import { initLumora } from "../src/runtime";
import { defineResource } from "../src/resource";

describe("LP-04 Custom JWT Claims & afterVerify", () => {
  test("afterVerify hook is called and can reject requests", async () => {
    const secret = "test-secret";
    let hookCalled = false;
    let hookAuth: any = null;

    const config: LumoraConfig = {
      name: "test-claims",
      mode: "development",
      api: { base: "/api", version: "v1" },
      auth: {
        mode: "jwt",
        secret,
        customClaims: { fields: ["companyId", "plan"] },
        afterVerify: (auth, c) => {
          hookCalled = true;
          hookAuth = auth;
          if (auth.claims?.plan !== "pro") {
            return new Response("Payment Required", { status: 402 });
          }
        }
      },
      database: { client: "sqlite", url: ":memory:" },
      resources: [
        defineResource({
          resource: "widgets",
          fields: {
            title: { type: "string" }
          },
          auth: { mode: "inherit" }
        })
      ]
    };

    const server = await initLumora(config);
    const app = server.app;

    // 1. Valid token, but plan !== "pro" (gets 402)
    const tokenBasic = await sign({ sub: "u1", plan: "basic", companyId: "c1" }, secret);
    const req1 = new Request("http://localhost/api/v1/widgets", {
      headers: { Authorization: `Bearer ${tokenBasic}` }
    });
    const res1 = await app.fetch(req1);
    
    expect(hookCalled).toBe(true);
    expect(hookAuth).not.toBeNull();
    expect(hookAuth.claims?.companyId).toBe("c1");
    expect(res1.status).toBe(402);
    expect(await res1.text()).toBe("Payment Required");

    // 2. Valid token, plan === "pro" (gets 200)
    hookCalled = false;
    const tokenPro = await sign({ sub: "u2", plan: "pro", companyId: "c2" }, secret);
    const req2 = new Request("http://localhost/api/v1/widgets", {
      headers: { Authorization: `Bearer ${tokenPro}` }
    });
    const res2 = await app.fetch(req2);
    
    expect(hookCalled).toBe(true);
    expect(res2.status).toBe(200);

    await server.database.close();
  });
});
