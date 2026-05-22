/**
 * LS-5: Export Engine — CSV only (zero external dependencies)
 *
 * Implements RFC 4180 compliant CSV serialization of resource records.
 * No external packages required.
 */

import type { DefineResourceResult, ResourceExportCsvOptions } from "./types";

/**
 * Escape a single value for RFC 4180 CSV output.
 * Wraps in double-quotes and escapes internal double-quotes if the value
 * contains commas, double-quotes, or newline characters.
 */
function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  // RFC 4180 §2.7: fields containing COMMA, DQUOTE, or CRLF must be enclosed in DQUOTE
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize an array of resource records to a CSV string.
 *
 * Column order:
 * - If `options.columns` is provided, use that order exactly.
 * - Otherwise: `id`, then all non-hidden schema fields in definition order, then `createdAt`, `updatedAt`.
 *
 * @param records  Array of normalised records (from database.list)
 * @param resource The resource definition (used to determine visible fields)
 * @param options  Optional column override and filename hint
 * @returns        RFC 4180 CSV string (CRLF line endings)
 */
export function exportToCsv(
  records: Record<string, unknown>[],
  resource: DefineResourceResult,
  options?: ResourceExportCsvOptions
): string {
  let columns: string[];

  if (options?.columns && options.columns.length > 0) {
    columns = options.columns;
  } else {
    // Default: id + all non-hidden schema fields + timestamps
    const schemaColumns = Object.entries(resource.fields)
      .filter(([, field]) => !field.hidden)
      .map(([name]) => name);
    columns = ["id", ...schemaColumns, "createdAt", "updatedAt"];
  }

  const header = columns.join(",");
  const rows = records.map((record) =>
    columns.map((col) => escapeCsvValue(record[col])).join(",")
  );

  return [header, ...rows].join("\r\n");
}

/**
 * Return the download filename for a CSV export.
 * Uses the option if provided, otherwise generates `{resource}-export.csv`.
 */
export function getCsvFilename(resource: DefineResourceResult, options?: ResourceExportCsvOptions): string {
  return options?.filename ?? `${resource.resource}-export.csv`;
}
