import { describe, expect, test, mock } from "bun:test";
import { createEmailService } from "../src/email";
import { SQL } from "bun";

describe("Email Plugin", () => {
  test("source: static -> test() resolves", async () => {
    // we use a real db, but test the function
    const svc = createEmailService({
      source: "static",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "u",
      pass: "p",
      fromName: "n",
      fromEmail: "e"
    });
    // This will try to actually connect to smtp.example.com unless mocked.
    // Given no real mocked module for nodemailer here, we check that it creates a transporter.
    // If it fails to verify, it should return { ok: false, error: ... }
    const res = await svc.test();
    expect(res.ok).toBe(false); // since it's a fake server
  });

  test("source: db -> reads from mock SQL", async () => {
    const sql = new SQL("sqlite://:memory:");
    await sql.connect();
    await sql.unsafe(`CREATE TABLE settings (key TEXT, value TEXT)`);
    await sql.unsafe(`INSERT INTO settings VALUES ('smtp_host', 'mock-host'), ('smtp_port', '25'), ('smtp_secure', 'false')`);
    
    const svc = createEmailService({
      source: "db",
      table: "settings",
      keyColumn: "key",
      valueColumn: "value"
    }, sql);

    const res = await svc.test();
    expect(res.ok).toBe(false); // since mock-host doesn't exist
    expect(res.error).toContain("getaddrinfo"); // should fail with dns lookup or similar

    await sql.close();
  });

  test("Missing db config throws error", async () => {
    const svc = createEmailService({
      source: "db",
      table: "settings"
    });
    
    let err = "";
    try {
      await svc.test();
    } catch (e: any) {
      err = e.message;
    }
    // Note: the test method catches it inside, so it returns an error
    const res = await svc.test();
    expect(res.ok).toBe(false);
    expect(res.error).toContain("requires a database connection");
  });
});
