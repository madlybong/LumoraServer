import { initLumora } from "@astrake/lumora-server";

const configPath = process.env.LUMORA_CONFIG ?? "./apps/starter/lumora.config.ts";
const lumora = await initLumora(configPath);

const server = Bun.serve({
  port: lumora.config.server.port,
  fetch: lumora.fetch,
  websocket: lumora.websocket,
});

console.log(`[lumora] Todo app running on :${server.port} (${lumora.config.name})`);
