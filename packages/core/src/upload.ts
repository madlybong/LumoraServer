/**
 * LS-3: File Upload / Media Attachments
 *
 * Handles multipart/form-data file uploads for resources that declare `file` or `file[]` fields.
 * Zero external dependencies — uses Hono's parseBody, Bun.write, and node:path only.
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Context } from "hono";
import type { DefineResourceResult, ResolvedLumoraConfig } from "./types";

const DEFAULT_SERVE_AT = "/__lumora/uploads";

/**
 * Parse a human-readable size string (e.g. "10MB") into bytes.
 */
function parseMaxSize(maxSize: string): number {
  const match = maxSize.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
  if (!match) return Infinity;
  const value = parseFloat(match[1]!);
  const unit = match[2]!.toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024
  };
  return value * (multipliers[unit] ?? 1);
}

/**
 * Returns true if the resource has any file or file[] fields.
 */
export function hasFileFields(resource: DefineResourceResult): boolean {
  return Object.values(resource.fields).some((f) => f.type === "file" || f.type === "file[]");
}

/**
 * Handle multipart/form-data upload for a resource request.
 *
 * Validates MIME types and file sizes per field options.
 * Writes accepted files to `config.upload.dir` using `Bun.write`.
 * Returns a map of { fieldName → URL string (or URL[] for file[] fields) }.
 */
export async function handleFileUpload(
  c: Context,
  resource: DefineResourceResult,
  config: ResolvedLumoraConfig
): Promise<Record<string, string | string[]>> {
  const uploadDir = config.upload?.dir ?? "./uploads";
  const serveAt = config.upload?.serveAt ?? DEFAULT_SERVE_AT;

  // Parse multipart body — all: true collects arrays for multi-file inputs
  const body = await c.req.parseBody({ all: true });
  const fileMap: Record<string, string | string[]> = {};

  // Ensure the upload directory exists
  await mkdir(uploadDir, { recursive: true });

  for (const [fieldName, field] of Object.entries(resource.fields)) {
    if (field.type !== "file" && field.type !== "file[]") continue;

    const rawValue = body[fieldName];
    if (!rawValue) continue;

    const files = Array.isArray(rawValue) ? rawValue : [rawValue];
    const opts = field.fileOptions ?? {};
    const maxSizeBytes = opts.maxSize ? parseMaxSize(opts.maxSize) : Infinity;
    const maxCount = opts.maxCount ?? (field.type === "file[]" ? Infinity : 1);
    const saved: string[] = [];

    for (const file of files.slice(0, maxCount)) {
      // Skip non-File values (text fields in the multipart body)
      if (!(file instanceof File)) continue;

      // Validate MIME type / extension
      if (opts.accept && opts.accept.length > 0) {
        const accepted = opts.accept.some((pattern) => {
          if (pattern.endsWith("/*")) {
            return file.type.startsWith(pattern.slice(0, -2));
          }
          if (pattern.startsWith(".")) {
            return file.name.toLowerCase().endsWith(pattern.toLowerCase());
          }
          return file.type === pattern;
        });
        if (!accepted) {
          throw new Error(`File type "${file.type}" not accepted for field "${fieldName}"`);
        }
      }

      // Validate file size
      if (file.size > maxSizeBytes) {
        throw new Error(`File "${file.name}" (${file.size} bytes) exceeds max size of "${opts.maxSize}" for field "${fieldName}"`);
      }

      // Generate a unique filename preserving the original extension
      const ext = path.extname(file.name);
      const filename = `${crypto.randomUUID()}${ext}`;
      const filePath = path.join(uploadDir, filename);

      await Bun.write(filePath, await file.arrayBuffer());
      saved.push(`${serveAt}/${filename}`);
    }

    // For file[]: return array; for file: return single string
    fileMap[fieldName] = field.type === "file[]" ? saved : (saved[0] ?? "");
  }

  return fileMap;
}

/**
 * Serve a single uploaded file by filename from the upload directory.
 * Returns a Response with the file contents, or 404 if not found.
 */
export async function serveUploadedFile(filename: string, uploadDir: string): Promise<Response> {
  const filePath = path.join(uploadDir, path.basename(filename));
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response(JSON.stringify({ ok: false, error: "File not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  return new Response(file);
}
