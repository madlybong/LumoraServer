import { initLumora, createModuleContext } from "@astrake/lumora-server";
import customRoutes from "./routes/custom.js";

const configPath = process.env.LUMORA_CONFIG ?? "./apps/starter/lumora.config.ts";
const lumora = await initLumora(configPath);
const _ctx = createModuleContext(lumora);

console.log(`[lumora] API prefix: ${lumora.apiPrefix}`);
lumora.mountModule("/custom", customRoutes, {
  rateLimit: true,
  audit: { hashChain: true },
  openApiTags: ["custom"]
});

const server = Bun.serve({
  port: lumora.config.server.port,
  fetch: lumora.fetch,
  websocket: lumora.websocket,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    server.stop(true);
    await lumora.stop();
    process.exit(0);
  });
}

console.log(`[lumora] Todo app running on :${server.port} (${lumora.config.name})`);
