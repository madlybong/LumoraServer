import { describe, expect, test } from "bun:test";
import { initLumora } from "@astrake/lumora-server";

describe("starter runtime", () => {
  test("boots from typed lumora config", async () => {
    const lumora = await initLumora("./apps/starter/lumora.config.ts");
    const response = await lumora.app.request("/api/v1/company");
    expect(response.status).toBe(200);
    await lumora.close();
  });
});
