import { defineLumoraConfig } from "../src/index";

export default defineLumoraConfig({
  name: "test-pg",
  mode: "test",
  api:  { base: "/api", version: "v1" },
  auth: { mode: "disabled" },
  database: {
    client: "postgresql",
    url:    process.env.TEST_PG_URL ?? "postgres://lumora_test:lumora_test@localhost:5432/lumora_test",
    schema: "lumora_test_schema",
    pool:   { min: 1, max: 5 },
    ssl:    false,
  },
  migrations: { mode: "off" },
});
