import { initLumora } from "@astrake/lumora-server";

const lumora = await initLumora("./apps/starter/lumora.config.ts");

const server = Bun.serve({
  port: lumora.config.server.port,
  fetch: lumora.fetch,
  websocket: lumora.websocket
});
