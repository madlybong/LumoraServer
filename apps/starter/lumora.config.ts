import { defineLumoraConfig } from "@astrake/lumora";

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
  docs: {
    enabled: true
  },
  admin: {
    enabled: false,
    path: "/admin"
  }
});
