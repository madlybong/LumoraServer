import { initLumora } from "@astrake/lumora";

const lumora = await initLumora("./apps/starter/lumora.config.ts");

const server = Bun.serve({
  port: lumora.config.server.port,
  fetch: lumora.fetch,
  websocket: lumora.websocket
});

console.log(`Lumora starter listening on http://localhost:${server.port}`);
