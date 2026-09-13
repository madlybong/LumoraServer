import { initLumora, createModuleContext, rateLimit } from "@astrake/lumora-server";

const configPath = process.env.LUMORA_CONFIG ?? "./apps/starter/lumora.config.ts";
const lumora = await initLumora(configPath);
const ctx = createModuleContext(lumora);

console.log(`[lumora] API prefix: ${lumora.apiPrefix}`);
import customRoutes from "./routes/custom.js";
lumora.app.route("/custom", customRoutes);

const server = Bun.serve({
  port: lumora.config.server.port,
  fetch: lumora.fetch,
  websocket: lumora.websocket,
});

console.log(`[lumora] Todo app running on :${server.port} (${lumora.config.name})`);
