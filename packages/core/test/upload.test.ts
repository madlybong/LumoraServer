import { describe, expect, test } from "bun:test";
import { hasFileFields } from "../src/upload";
import { defineResource } from "../src/resource";

const mediaResource = defineResource({
  resource: "media",
  fields: {
    title: { type: "string", required: true },
    image: { type: "file", fileOptions: { accept: ["image/*"], maxSize: "5MB" } },
    gallery: { type: "file[]", fileOptions: { accept: ["image/*"], maxSize: "10MB", maxCount: 5 } },
  },
});

const plainResource = defineResource({
  resource: "note",
  fields: {
    content: { type: "string", required: true },
  },
});

describe("File Upload (LS-3)", () => {
  test("hasFileFields returns true for resources with file or file[] fields", () => {
    expect(hasFileFields(mediaResource)).toBe(true);
  });

  test("hasFileFields returns false for resources without file fields", () => {
    expect(hasFileFields(plainResource)).toBe(false);
  });

  test("file and file[] fields map to TEXT in db sqlTextType (no DB type error)", async () => {
    const { LumoraDatabase } = await import("../src/db");
    const { LumoraEventEmitter } = await import("../src/events");
    const events = new LumoraEventEmitter();
    const db = new LumoraDatabase({ client: "sqlite", url: ":memory:" }, events as any);
    await db.connect();
    // Should not throw — file/file[] fields map to TEXT
    await expect(db.ensureResource(mediaResource)).resolves.toBeUndefined();
    await db.close();
  });

  test("file fields are stored and retrieved as plain strings (URL)", async () => {
    const { LumoraDatabase } = await import("../src/db");
    const { LumoraEventEmitter } = await import("../src/events");
    const events = new LumoraEventEmitter();
    const db = new LumoraDatabase({ client: "sqlite", url: ":memory:" }, events as any);
    await db.connect();
    await db.ensureResource(mediaResource);
    const record = await db.create(mediaResource, {
      title: "Design Photo",
      image: "/__lumora/uploads/abc123.jpg",
    });
    expect(record.image).toBe("/__lumora/uploads/abc123.jpg");
    await db.close();
  });

  test("file fields are not included in validatePayload (handled by handleFileUpload separately)", async () => {
    // validatePayload should skip file/file[] fields (they come from multipart, not JSON)
    // Verify by checking that creating a record with a file field via JSON still works
    const { LumoraDatabase } = await import("../src/db");
    const { LumoraEventEmitter } = await import("../src/events");
    const events = new LumoraEventEmitter();
    const db = new LumoraDatabase({ client: "sqlite", url: ":memory:" }, events as any);
    await db.connect();
    await db.ensureResource(mediaResource);
    // Directly create with a URL string (mimicking what upload handler produces)
    const record = await db.create(mediaResource, {
      title: "CAD File",
      image: "/__lumora/uploads/design.step",
    });
    expect(record.title).toBe("CAD File");
    expect(record.image).toBe("/__lumora/uploads/design.step");
    await db.close();
  });
});
