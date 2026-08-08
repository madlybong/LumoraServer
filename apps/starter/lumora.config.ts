import { defineLumoraConfig } from "@astrake/lumora-server";

export default defineLumoraConfig({
  name: "lumora-todo-sqlite",
  mode: "development",
  api:  { base: "/api", version: "v1" },
  auth: { mode: "disabled" },
  database: { client: "sqlite", url: "sqlite://./lumora.db" },
  routes: { dir: "./routes" },
  migrations: { dir: "./migrations/sqlite" },
  docs: { enabled: true },
  cors: { origin: "*" },
  rateLimit: {
    enabled: true,
    max: 100,
    windowMs: 60000,
    store: "memory"
  },
  schedule: [
    {
      name: "Cleanup logs",
      cron: "0 0 * * *",
      log: true,
      handler: async (ctx) => {
        console.log("Running scheduled cleanup task!");
      }
    }
  ]
});
