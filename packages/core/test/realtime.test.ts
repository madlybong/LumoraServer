import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";

async function createRealtimeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-realtime-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    path.join(routesDir, "company.ts"),
    `export default {
  kind: "resource",
  resource: "company",
  fields: { name: { type: "string", required: true } }
};`
  );

  return initLumora({
    name: "realtime",
    mode: "development",
    api: { base: "/api", version: "v1" },
    auth: { mode: "disabled" },
    database: { client: "sqlite", url: "sqlite://:memory:" },
    routes: { dir: routesDir }
  });
}

describe("realtime", () => {
  test("publishes SSE and WebSocket messages", async () => {
    const lumora = await createRealtimeFixture();
    const server = Bun.serve({
      port: 0,
      fetch: lumora.fetch,
      websocket: lumora.websocket
    });

    const sseResponse = await fetch(`http://127.0.0.1:${server.port}/api/v1/company/events`);
    const reader = sseResponse.body!.getReader();
    await reader.read();

    const received = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/api/v1/company/ws`);
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string" && event.data.includes("message")) {
          resolve(event.data);
          socket.close();
        }
      });
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ hello: "world" }));
      });
      socket.addEventListener("error", () => reject(new Error("WebSocket failed")));
    });

    expect(received).toContain("message");

    await fetch(`http://127.0.0.1:${server.port}/api/v1/company`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Realtime Co" })
    });
    let text = "";
    while (!text.includes("created")) {
      const chunk = await reader.read();
      text = new TextDecoder().decode(chunk.value);
    }
    expect(text).toContain("created");

    server.stop(true);
    await lumora.close();
  });
});
