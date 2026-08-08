import { describe, expect, test } from "bun:test";
import { initLumora } from "@astrake/lumora-server";

import path from "node:path";

describe("starter runtime", () => {
  test("boots from typed lumora config", async () => {
    const configPath = path.join(import.meta.dir, "../lumora.config.ts");
    const lumora = await initLumora(configPath);
    const response = await lumora.app.request("/api/v1/todos");
    expect(response.status).toBe(200);
    await lumora.close();
  });
});
