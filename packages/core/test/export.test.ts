import { describe, expect, test } from "bun:test";
import { exportToCsv, getCsvFilename } from "../src/export";
import { defineResource } from "../src/resource";

const invoiceResource = defineResource({
  resource: "invoice",
  fields: {
    customer_name: { type: "string", required: true },
    amount: { type: "number", required: true },
    notes: { type: "string" },
    internal_ref: { type: "string", hidden: true }, // should be excluded from CSV
  },
  export: { csv: true },
});

const records = [
  { id: "inv-1", customer_name: "Priya Sharma", amount: 45000, notes: "Gold ring", internal_ref: "INTERNAL", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
  { id: "inv-2", customer_name: "Rahul Sen", amount: 12500, notes: "Silver necklace", internal_ref: "HIDDEN", createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
];

describe("CSV Export (LS-5)", () => {
  test("produces a header row matching non-hidden schema fields", () => {
    const csv = exportToCsv(records, invoiceResource);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("id,customer_name,amount,notes,createdAt,updatedAt");
    // hidden field 'internal_ref' must NOT appear
    expect(lines[0]).not.toContain("internal_ref");
  });

  test("produces correct number of data rows", () => {
    const csv = exportToCsv(records, invoiceResource);
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(3); // 1 header + 2 data rows
  });

  test("data rows contain correct field values", () => {
    const csv = exportToCsv(records, invoiceResource);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("inv-1");
    expect(lines[1]).toContain("Priya Sharma");
    expect(lines[1]).toContain("45000");
    expect(lines[2]).toContain("inv-2");
    expect(lines[2]).toContain("Rahul Sen");
  });

  test("RFC 4180: values containing commas are wrapped in double-quotes", () => {
    const csv = exportToCsv(
      [{ id: "1", customer_name: "Smith, John", amount: 1000, notes: "", createdAt: "", updatedAt: "" }],
      invoiceResource
    );
    expect(csv).toContain('"Smith, John"');
  });

  test("RFC 4180: values containing double-quotes are escaped", () => {
    const csv = exportToCsv(
      [{ id: "1", customer_name: 'He said "hello"', amount: 500, notes: "", createdAt: "", updatedAt: "" }],
      invoiceResource
    );
    expect(csv).toContain('"He said ""hello"""');
  });

  test("RFC 4180: values containing newlines are wrapped in double-quotes", () => {
    const csv = exportToCsv(
      [{ id: "1", customer_name: "Multi\nLine", amount: 200, notes: "", createdAt: "", updatedAt: "" }],
      invoiceResource
    );
    expect(csv).toContain('"Multi\nLine"');
  });

  test("null and undefined values are serialized as empty string", () => {
    const csv = exportToCsv(
      [{ id: "1", customer_name: "Test", amount: null, notes: undefined, createdAt: "", updatedAt: "" }],
      invoiceResource
    );
    // Columns: id, customer_name, amount, notes, createdAt, updatedAt (6 total)
    // internal_ref is hidden so excluded; amount=null → "", notes=undefined → "", timestamps → ""
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("1,Test,,,,");
  });


  test("respects explicit columns override", () => {
    const csv = exportToCsv(records, invoiceResource, { columns: ["id", "amount"] });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("id,amount");
    expect(lines[1]).toBe("inv-1,45000");
  });

  test("getCsvFilename returns resource name based default", () => {
    const filename = getCsvFilename(invoiceResource);
    expect(filename).toBe("invoice-export.csv");
  });

  test("getCsvFilename uses custom filename option when provided", () => {
    const filename = getCsvFilename(invoiceResource, { filename: "my-invoices.csv" });
    expect(filename).toBe("my-invoices.csv");
  });
});
