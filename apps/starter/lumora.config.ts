import { defineLumoraConfig } from "@astrake/lumora-server";

export default defineLumoraConfig({
  name: "lumora-starter",
  mode: (process.env.NODE_ENV === "production" ? "production" : "development") as "development" | "production",
  api: {
    base: "/api",
    version: "v1"
  },
  auth:
    process.env.NODE_ENV === "production"
      ? { mode: "static", token: process.env.LUMORA_STATIC_TOKEN ?? "change-me" }
      : { mode: "disabled" },
  database: {
    client: "sqlite",
    url: "sqlite://./apps/starter/lumora.db"
  },
  routes: {
    dir: "./routes"
  },
  // Migration files: apps/starter/migrations/YYYYMMDD_NNN_description.sql
  // dev  → applied automatically on startup
  // prod → run `bun run lumora migrate` before deploying
  migrations: {
    dir: "./apps/starter/migrations"
  },
  docs: {
    enabled: true
  },
  admin: {
    enabled: false,
    path: "/admin"
  },
  cors: {
    origin: "*"
  }
});
