import type { DefineResourceResult, ResolvedLumoraConfig } from "./types";

export type LumoraLogLevel = "silent" | "minimal" | "verbose";

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m"
};

function pad(str: string, length: number): string {
  return str + " ".repeat(Math.max(0, length - str.length));
}

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET": return colors.cyan;
    case "POST": return colors.green;
    case "PUT": return colors.yellow;
    case "DELETE": return colors.red;
    default: return colors.gray;
  }
}

function statusColor(status: number): string {
  if (status >= 500) return colors.red;
  if (status >= 400) return colors.yellow;
  if (status >= 300) return colors.cyan;
  if (status >= 200) return colors.green;
  return colors.gray;
}

export class LumoraLogger {
  constructor(private readonly level: LumoraLogLevel) {}

  private write(msg: string) {
    if (this.level !== "silent") {
      process.stdout.write(msg + "\n");
    }
  }

  banner(config: ResolvedLumoraConfig, resources: DefineResourceResult[]) {
    if (this.level === "silent") return;

    if (this.level === "minimal") {
      this.write(`  ${colors.cyan}✦${colors.reset}  ${colors.bold}${config.name}${colors.reset}  ready on :${config.server.port}  ${colors.dim}[${config.mode} · ${config.auth.mode}-auth · ${config.database.client}]${colors.reset}`);
      return;
    }

    const width = 46;
    const line = "─".repeat(width);
    
    this.write(`┌${line}┐`);
    this.write(`│  ${colors.cyan}✦${colors.reset}  ${colors.bold}Lumora${colors.reset}  ·  ${config.name}  ·  ${colors.cyan}${config.mode}${colors.reset}${pad("", width - 20 - config.name.length - config.mode.length)}│`);
    this.write(`├${line}┤`);
    
    this.write(`│  ${colors.dim}Port${colors.reset}     ${config.server.port}${pad("", width - 12 - String(config.server.port).length)}│`);
    this.write(`│  ${colors.dim}Auth${colors.reset}     ${config.auth.mode}${pad("", width - 12 - config.auth.mode.length)}│`);
    
    const dbStr = `${config.database.client} · ${config.database.url.replace(/^sqlite:\/\//, "")}`;
    this.write(`│  ${colors.dim}DB${colors.reset}       ${dbStr}${pad("", width - 12 - dbStr.length)}│`);
    
    const docsStr = config.docs.enabled ? `http://localhost:${config.server.port}${config.docs.path}` : "disabled";
    this.write(`│  ${colors.dim}Docs${colors.reset}     ${docsStr}${pad("", width - 12 - docsStr.length)}│`);
    
    const pluginsStr = `email ${config.email ? "✓" : "✗"}  ai ${config.ai ? "✓" : "✗"}`;
    this.write(`│  ${colors.dim}Plugins${colors.reset}  ${pluginsStr}${pad("", width - 12 - pluginsStr.length + (config.email ? 0 : 0))}│`);
    
    this.write(`├${line}┤`);
    this.write(`│  ${colors.bold}Resources (${resources.length})${colors.reset}${pad("", width - 14 - String(resources.length).length)}│`);
    
    for (const res of resources) {
      const pathStr = `/${config.api.base.replace(/^\//, "")}/${config.api.version.replace(/^\//, "")}/${res.resource.replace(/^\//, "")}`.replace(/\/+/g, "/");
      const methods = `${colors.cyan}GET${colors.reset}  ${colors.green}POST${colors.reset}  ${colors.yellow}PUT${colors.reset}  ${colors.red}DELETE${colors.reset}`;
      this.write(`│    ${pad(pathStr, 16)}  ${methods}${pad("", width - 24 - Math.max(16, pathStr.length))}│`);
    }
    
    this.write(`└${line}┘\n`);
  }

  request(method: string, path: string, status: number, durationMs: number, requestId: string, errorMsg?: string) {
    if (this.level !== "verbose") return;

    const icon = status >= 400 ? `${colors.red}✗${colors.reset}` : `${colors.green}→${colors.reset}`;
    const mColor = methodColor(method);
    const sColor = statusColor(status);
    const reqIdStr = requestId.split("-")[0];
    
    const msg = `  ${icon}  ${mColor}${pad(method, 5)}${colors.reset} ${pad(path, 22)} ${sColor}${pad(String(status), 3)}${colors.reset}  ${pad(String(durationMs) + "ms", 5)} ${colors.dim}[${reqIdStr}]${colors.reset}`;
    
    if (errorMsg) {
      this.write(`${msg}  ${colors.red}${errorMsg}${colors.reset}`);
    } else {
      this.write(msg);
    }
  }

  event(label: string, message: string) {
    if (this.level !== "verbose") return;
    this.write(`  ${colors.cyan}ℹ${colors.reset}  ${colors.dim}${pad(label, 7)} ${message}${colors.reset}`);
  }

  error(context: string, err: unknown, requestId?: string) {
    if (this.level === "silent") return;
    const reqIdStr = requestId ? ` [${requestId.split("-")[0]}]` : "";
    const prefix = this.level === "minimal" ? `  ${colors.red}✗  ${new Date().toISOString()}${colors.reset}` : `  ${colors.red}✗${colors.reset}  ${colors.dim}${pad(context, 7)}${colors.reset}`;
    this.write(`${prefix}  ${colors.red}${err}${colors.reset}${colors.dim}${reqIdStr}${colors.reset}`);
  }

  info(message: string) {
    if (this.level !== "verbose") return;
    this.write(`  ${colors.gray}${message}${colors.reset}`);
  }
}
