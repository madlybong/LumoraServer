import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scaffoldLumoraProject } from "../src/init-wizard";

describe("scaffoldLumoraProject", () => {
  test("creates lumora config and routes in an empty directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumora-init-"));
    await scaffoldLumoraProject(
      dir,
      {
        projectName: "demo-app",
        base: "/api",
        version: "v1",
        mode: "development",
        auth: "disabled",
        database: "sqlite",
        routesDir: "routes",
        docs: true
      },
      false
    );

    const config = await readFile(path.join(dir, "lumora.config.ts"), "utf8");
    const route = await readFile(path.join(dir, "routes", "company.ts"), "utf8");
    expect(config).toContain("defineLumoraConfig");
    expect(route).toContain('resource: "company"');
  });
});
