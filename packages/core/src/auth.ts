import type { Context } from "hono";
import type { LumoraAuthConfig, LumoraAuthResult } from "./types";

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, "base64").toString("utf8");
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

export interface SignJwtOptions {
  expiresInSeconds?: number;
  issuer?: string;
  audience?: string;
}

/**
 * Signs an HS256 JWT token using native Web Crypto HMAC SHA-256.
 */
export async function signLumoraJwt(
  payload: Record<string, unknown>,
  secret: string,
  options?: SignJwtOptions
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    iat: now,
    ...payload,
  };
  if (options?.expiresInSeconds !== undefined && claims.exp === undefined) {
    claims.exp = now + options.expiresInSeconds;
  }
  if (options?.issuer !== undefined && claims.iss === undefined) {
    claims.iss = options.issuer;
  }
  if (options?.audience !== undefined && claims.aud === undefined) {
    claims.aud = options.audience;
  }

  const headerPart = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadPart = base64UrlEncode(JSON.stringify(claims));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`${headerPart}.${payloadPart}`));
  const signaturePart = Buffer.from(signed).toString("base64url");
  return `${headerPart}.${payloadPart}.${signaturePart}`;
}

export interface RotateTokensOptions {
  secret: string;
  refreshSecret?: string;
  accessExpiresInSeconds?: number;
  refreshExpiresInSeconds?: number;
  issuer?: string;
  audience?: string;
  clockSkewSeconds?: number;
}

/**
 * Verifies a refresh token and rotates it into a new access + refresh token pair.
 */
export async function rotateLumoraTokens(
  refreshToken: string,
  options: RotateTokensOptions
): Promise<{ accessToken: string; refreshToken: string; claims: Record<string, unknown> }> {
  const verifySecret = options.refreshSecret ?? options.secret;
  const claims = await verifyJwtToken(refreshToken, verifySecret, options.clockSkewSeconds ?? 0);

  if (options.issuer && claims.iss !== options.issuer) {
    throw new Error("Unexpected JWT issuer.");
  }
  if (options.audience && claims.aud !== options.audience) {
    throw new Error("Unexpected JWT audience.");
  }

  const baseClaims: Record<string, unknown> = { ...claims };
  delete baseClaims.iat;
  delete baseClaims.exp;
  delete baseClaims.jti;
  delete baseClaims.token_use;
  delete baseClaims.type;

  const accessToken = await signLumoraJwt(
    { ...baseClaims, jti: crypto.randomUUID(), token_use: "access", type: "access" },
    options.secret,
    {
      expiresInSeconds: options.accessExpiresInSeconds ?? 900,
      issuer: options.issuer,
      audience: options.audience,
    }
  );

  const nextRefreshToken = await signLumoraJwt(
    { ...baseClaims, jti: crypto.randomUUID(), token_use: "refresh", type: "refresh" },
    verifySecret,
    {
      expiresInSeconds: options.refreshExpiresInSeconds ?? 604_800,
      issuer: options.issuer,
      audience: options.audience,
    }
  );

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    claims: baseClaims,
  };
}

export async function verifyJwtToken(
  token: string,
  secret: string,
  optionsOrSkew: number | { clockSkewSeconds?: number; issuer?: string; audience?: string } = 0
): Promise<Record<string, unknown>> {
  const clockSkewSeconds = typeof optionsOrSkew === "number" ? optionsOrSkew : (optionsOrSkew.clockSkewSeconds ?? 0);
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error("Malformed JWT token.");
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
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

  if (typeof claims.exp === "number" && claims.exp < Math.floor(Date.now() / 1000) - clockSkewSeconds) {
    throw new Error("JWT token has expired.");
  }

  if (typeof optionsOrSkew === "object") {
    if (optionsOrSkew.issuer && claims.iss !== optionsOrSkew.issuer) {
      throw new Error("Unexpected JWT issuer.");
    }
    if (optionsOrSkew.audience && claims.aud !== optionsOrSkew.audience) {
      throw new Error("Unexpected JWT audience.");
    }
  }

  return claims;
}

export async function verifyLumoraJwt(
  token: string,
  secret: string,
  clockSkewSeconds = 0
): Promise<{ claims: Record<string, unknown> } | null> {
  try {
    const claims = await verifyJwtToken(token, secret, clockSkewSeconds);
    return { claims };
  } catch (err) {
    return null;
  }
}

async function verifyJwt(token: string, config: Extract<LumoraAuthConfig, { mode: "jwt" }>): Promise<LumoraAuthResult> {
  const claims = await verifyJwtToken(token, config.secret, config.clockSkewSeconds);

  if (config.issuer && claims.iss !== config.issuer) {
    throw new Error("Unexpected JWT issuer.");
  }
  if (config.audience && claims.aud !== config.audience) {
    throw new Error("Unexpected JWT audience.");
  }

  const mapping = config.claimMapping;
  const subjectKey = mapping?.subject ?? "sub";
  const rolesKey = mapping?.roles ?? "roles";
  const tenantKey = mapping?.tenantId ?? "tenant_id";

  const rawSubject = claims[subjectKey] ?? claims.sub ?? "anonymous";
  const rawRoles = claims[rolesKey] ?? claims.roles;
  let roles: string[] | undefined;
  if (Array.isArray(rawRoles)) {
    roles = rawRoles.map(String);
  } else if (typeof rawRoles === "string" && rawRoles.length > 0) {
    roles = [rawRoles];
  }

  const extractedScope: Record<string, unknown> =
    claims.scope && typeof claims.scope === "object" && !Array.isArray(claims.scope)
      ? { ...(claims.scope as Record<string, unknown>) }
      : {};

  const tenantVal = claims[tenantKey] ?? claims.tenant_id ?? extractedScope[tenantKey] ?? extractedScope.tenant_id;
  if (tenantVal !== undefined) {
    extractedScope.tenant_id = tenantVal;
    extractedScope[tenantKey] = tenantVal;
  }

  if (mapping?.scopes) {
    for (const scopeKey of mapping.scopes) {
      if (claims[scopeKey] !== undefined) {
        extractedScope[scopeKey] = claims[scopeKey];
      }
    }
  }

  return {
    subject: String(rawSubject),
    strategy: "jwt",
    token,
    claims,
    roles,
    // LS-9: extract scope from JWT claims for store-scoped permission enforcement
    scope: Object.keys(extractedScope).length > 0 ? extractedScope : undefined
  };
}

/**
 * Resolves authentication from a request context based on the provided configuration.
 *
 * Security Note: When using JWT mode, this function explicitly enforces the `exp` (expiration)
 * claim on every code path. If the token is expired, this function throws an error.
 */
export async function resolveAuthFromContext(
  c: Context,
  auth: LumoraAuthConfig,
  tokenOverride?: string
): Promise<LumoraAuthResult | undefined> {
  if (auth.mode === "disabled") {
    return undefined;
  }

  if (auth.mode === "custom") {
    const result = await auth.verify(c);
    if (!result) {
      throw new Error("Unauthorized.");
    }
    return {
      ...result,
      strategy: result.strategy ?? "custom"
    };
  }

  const headerName = auth.mode === "static" ? auth.header ?? "authorization" : "authorization";
  const headerValue = tokenOverride ?? c.req.header(headerName);
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
