import { defineLumoraConfig } from "@astrake/lumora-server";

export default defineLumoraConfig({
  name: "lumora-todo-pg",
  mode: "development",
  api:  { base: "/api", version: "v1" },
  auth: { mode: "disabled" },
  database: {
    client: "postgresql",
    url:    process.env.PG_URL ?? "postgres://postgres:postgres@localhost:5432/lumora_todo",
    schema: process.env.PG_SCHEMA ?? "public",
    pool:   { min: 2, max: 10 },
    ssl:    false,
  },
  routes: { dir: "./routes" },
  migrations: { dir: "./apps/starter/migrations/pg" },
  docs: { enabled: true },
  cors: { origin: "*" },
});
