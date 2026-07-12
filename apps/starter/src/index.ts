import { initLumora, createModuleContext, rateLimit } from "@astrake/lumora-server";

const configPath = process.env.LUMORA_CONFIG ?? "./apps/starter/lumora.config.ts";
const lumora = await initLumora(configPath);
const ctx = createModuleContext(lumora);

console.log(`[lumora] API prefix: ${lumora.apiPrefix}`);
// lumora.mountModule("/billing", createBillingRouter(ctx));

const server = Bun.serve({
  port: lumora.config.server.port,
  fetch: lumora.fetch,
  websocket: lumora.websocket,
});

console.log(`[lumora] Todo app running on :${server.port} (${lumora.config.name})`);
