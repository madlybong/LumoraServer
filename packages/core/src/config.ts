import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LumoraAuthConfig, LumoraConfig, ResolvedLumoraConfig } from "./types";

export function defineLumoraConfig<TConfig extends LumoraConfig>(config: TConfig): TConfig {
  return config;
}

export async function loadLumoraConfig(
  configOrPath: LumoraConfig | string,
  cwd = process.cwd()
): Promise<ResolvedLumoraConfig> {
  const loaded = typeof configOrPath === "string" ? await importConfigFile(configOrPath, cwd) : configOrPath;
  return resolveLumoraConfig(loaded, typeof configOrPath === "string" ? path.dirname(path.resolve(cwd, configOrPath)) : cwd);
}

async function importConfigFile(configPath: string, cwd: string): Promise<LumoraConfig> {
  const absolute = path.resolve(cwd, configPath);
  await access(absolute);
  const mod = await import(pathToFileURL(absolute).href);
  const config = mod.default ?? mod.config;
  if (!config) {
    throw new Error(`Missing default export from ${absolute}`);
  }
  return config satisfies LumoraConfig;
}

export function resolveLumoraConfig(config: LumoraConfig, rootDir: string): ResolvedLumoraConfig {
  validateAuth(config.mode, config.auth);

  const migrationMode = config.migrations?.mode ?? (
    config.mode === "development" ? "auto"
    : config.mode === "production" ? "strict"
    : "off"
  );

  return {
    ...config,
    rootDir,
    server: {
      port: config.server?.port ?? 3000
    },
    docs: {
      enabled: config.docs?.enabled ?? config.mode !== "production",
      path: config.docs?.path ?? "/__lumora/docs",
      openApiPath: config.docs?.openApiPath ?? "/__lumora/openapi.json"
    },
    realtime: {
      sseSuffix: config.realtime?.sseSuffix ?? "events",
      websocketSuffix: config.realtime?.websocketSuffix ?? "ws"
    },
    logging: {
      level: config.logging?.level ?? (
        config.mode === "development" ? "verbose" : config.mode === "production" ? "minimal" : "silent"
      )
    },
    cors: {
      origin: config.cors?.origin ?? (config.mode === "development" ? "*" : ""),
      methods: [
        ...new Set([
          ...(config.cors?.methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
          ...(config.cors?.allowMethods ?? [])
        ])
      ],
      headers: [
        ...new Set([
          ...(config.cors?.headers ?? ["Content-Type", "Authorization"]),
          ...(config.cors?.allowHeaders ?? [])
        ])
      ],
      credentials: config.cors?.credentials ?? false,
      exposeHeaders: config.cors?.exposeHeaders,
      maxAge: config.cors?.maxAge,
      passthrough: config.cors?.passthrough
    },
    rateLimit: {
      enabled: config.rateLimit?.enabled ?? false,
      max: config.rateLimit?.max ?? 100,
      windowMs: config.rateLimit?.windowMs ?? 60000,
      store: config.rateLimit?.store ?? "memory"
    },
    multiTenancy: {
      enabled: config.multiTenancy?.enabled ?? false,
      tenantIdField: config.multiTenancy?.tenantIdField ?? "tenant_id"
    },
    migrations: {
      dir: path.resolve(rootDir, config.migrations?.dir ?? "migrations"),
      mode: migrationMode,
      allowDowngrade: config.migrations?.allowDowngrade ?? false,
      blockDestructive: config.migrations?.blockDestructive ?? false
    }
  };
}

export function validateAuth(mode: LumoraConfig["mode"], auth: LumoraAuthConfig): void {
  if (mode === "production" && auth.mode === "disabled") {
    throw new Error("Production mode requires Lumora auth to be configured.");
  }

  if (auth.mode === "static" && !auth.token) {
    throw new Error("Static auth requires a token.");
  }

  if (auth.mode === "jwt" && !auth.secret) {
    throw new Error("JWT auth requires a secret.");
  }
}
