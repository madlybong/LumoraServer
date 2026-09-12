import { describe, expect, test } from "bun:test";
import { defineLumoraConfig, resolveLumoraConfig } from "../src/config";

describe("resolveLumoraConfig", () => {
  test("fills defaults and keeps typed config", () => {
    const config = resolveLumoraConfig(
      defineLumoraConfig({
        name: "demo",
        mode: "development",
        api: { base: "/api", version: "v1" },
        auth: { mode: "disabled" },
        database: { client: "sqlite", url: "sqlite://:memory:" },
        routes: { dir: "routes" }
      }),
      process.cwd()
    );

    expect(config.docs.enabled).toBe(true);
    expect(config.realtime.websocketSuffix).toBe("ws");
  });

  test("rejects production without auth", () => {
    expect(() =>
      resolveLumoraConfig(
        {
          name: "demo",
          mode: "production",
          api: { base: "/api", version: "v1" },
          auth: { mode: "disabled" },
          database: { client: "sqlite", url: "sqlite://:memory:" },
          routes: { dir: "routes" }
        },
        process.cwd()
      )
    ).toThrow();
  });

  describe("LP-03 blockDestructive", () => {
    test("production without explicit blockDestructive defaults to true", () => {
      const config = resolveLumoraConfig(
        {
          name: "demo",
          mode: "production",
          api: { base: "/api", version: "v1" },
          auth: { mode: "static", token: "secret" },
          database: { client: "sqlite", url: "sqlite://:memory:" },
          routes: { dir: "routes" }
        },
        process.cwd()
      );
      expect(config.migrations.blockDestructive).toBe(true);
    });

    test("production with explicit blockDestructive overrides default", () => {
      const config = resolveLumoraConfig(
        {
          name: "demo",
          mode: "production",
          api: { base: "/api", version: "v1" },
          auth: { mode: "static", token: "secret" },
          database: { client: "sqlite", url: "sqlite://:memory:" },
          routes: { dir: "routes" },
          migrations: { blockDestructive: false }
        },
        process.cwd()
      );
      expect(config.migrations.blockDestructive).toBe(false);
    });

    test("development without explicit blockDestructive defaults to false", () => {
      const config = resolveLumoraConfig(
        {
          name: "demo",
          mode: "development",
          api: { base: "/api", version: "v1" },
          auth: { mode: "disabled" },
          database: { client: "sqlite", url: "sqlite://:memory:" },
          routes: { dir: "routes" }
        },
        process.cwd()
      );
      expect(config.migrations.blockDestructive).toBe(false);
    });
  });
});
