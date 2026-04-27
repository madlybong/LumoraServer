import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { LumoraLogger } from "../src/logger";
import type { ResolvedLumoraConfig } from "../src/types";

describe("LumoraLogger", () => {
  let stdoutWrite: any;
  let output = "";

  beforeEach(() => {
    output = "";
    stdoutWrite = process.stdout.write;
    // Mock stdout
    process.stdout.write = (chunk: string | Uint8Array) => {
      output += chunk.toString();
      return true;
    };
  });

  afterEach(() => {
    // Restore stdout
    process.stdout.write = stdoutWrite;
  });

  const mockConfig = {
    name: "test-app",
    mode: "development",
    server: { port: 3000 },
    auth: { mode: "disabled" },
    database: { client: "sqlite", url: "sqlite://./test.db" },
    docs: { enabled: true, path: "/docs", openApiPath: "/openapi.json" },
    api: { base: "/api", version: "v1" }
  } as unknown as ResolvedLumoraConfig;

  test("silent level produces no output", () => {
    const logger = new LumoraLogger("silent");
    
    logger.banner(mockConfig, []);
    logger.request("GET", "/test", 200, 5, "req-1");
    logger.event("init", "testing");
    logger.error("test", new Error("boom"));
    logger.info("info");
    
    expect(output).toBe("");
  });

  test("minimal level produces minimal banner and no requests", () => {
    const logger = new LumoraLogger("minimal");
    
    logger.banner(mockConfig, []);
    expect(output).toContain("test-app");
    expect(output).toContain("ready on :3000");
    
    const beforeReqLen = output.length;
    logger.request("GET", "/test", 200, 5, "req-1");
    expect(output.length).toBe(beforeReqLen); // no change
  });

  test("verbose banner contains config and resources", () => {
    const logger = new LumoraLogger("verbose");
    
    logger.banner(mockConfig, [
      { kind: "resource", resource: "user", fields: {} },
      { kind: "resource", resource: "post", fields: {} }
    ]);
    
    expect(output).toContain("Lumora");
    expect(output).toContain("test-app");
    expect(output).toContain("/api/v1/user");
    expect(output).toContain("/api/v1/post");
  });

  test("verbose request log includes formatted string", () => {
    const logger = new LumoraLogger("verbose");
    
    logger.request("POST", "/api/v1/test", 201, 15, "abc-123");
    expect(output).toContain("POST");
    expect(output).toContain("/api/v1/test");
    expect(output).toContain("201");
    expect(output).toContain("15ms");
    expect(output).toContain("[abc]");
  });
});
