import type { Context } from "hono";
import type { LumoraAuthConfig, LumoraAuthResult } from "./types";

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, "base64").toString("utf8");
}

async function verifyJwt(token: string, config: Extract<LumoraAuthConfig, { mode: "jwt" }>): Promise<LumoraAuthResult> {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error("Malformed JWT token.");
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(config.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`${headerPart}.${payloadPart}`));
  const expectedSignature = Buffer.from(signed).toString("base64url");

  if (expectedSignature !== signaturePart) {
    throw new Error("Invalid JWT signature.");
  }

  const claims = JSON.parse(base64UrlDecode(payloadPart)) as Record<string, unknown>;
  if (config.issuer && claims.iss !== config.issuer) {
    throw new Error("Unexpected JWT issuer.");
  }
  if (config.audience && claims.aud !== config.audience) {
    throw new Error("Unexpected JWT audience.");
  }

  return {
    subject: String(claims.sub ?? "anonymous"),
    strategy: "jwt",
    token,
    claims
  };
}

export async function resolveAuthFromContext(
  c: Context,
  auth: LumoraAuthConfig
): Promise<LumoraAuthResult | undefined> {
  if (auth.mode === "disabled") {
    return undefined;
  }

  const headerName = auth.mode === "static" ? auth.header ?? "authorization" : "authorization";
  const headerValue = c.req.header(headerName);
  if (!headerValue) {
    throw new Error("Missing authorization header.");
  }

  const token = headerValue.startsWith("Bearer ") ? headerValue.slice(7) : headerValue;

  if (auth.mode === "static") {
    if (token !== auth.token) {
      throw new Error("Invalid static token.");
    }

    return {
      subject: "static-token",
      strategy: "static",
      token
    };
  }

  return verifyJwt(token, auth);
}
