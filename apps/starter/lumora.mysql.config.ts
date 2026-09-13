import { defineLumoraConfig } from "@astrake/lumora-server";

export default defineLumoraConfig({
  name: "lumora-todo-mysql",
  mode: "development",
  api:  { base: "/api", version: "v1" },
  auth: { mode: "disabled" },
  database: {
    client: "mysql",
    url: process.env.MYSQL_URL ?? "mysql://root:root@localhost:3306/lumora_todo",
  },
  routes: {
    dir: "./src/resources"
  },
  migrations: { dir: "./migrations/mysql" },
  docs: { enabled: true },
  cors: { origin: "*" },
});
