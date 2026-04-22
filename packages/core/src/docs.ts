import type { DefineResourceResult, OpenApiDocument, ResolvedLumoraConfig } from "./types";

export function buildOpenApiDocument(
  config: ResolvedLumoraConfig,
  resources: DefineResourceResult[]
): OpenApiDocument {
  const paths: OpenApiDocument["paths"] = {};

  for (const resource of resources) {
    const basePath = `/${trim(config.api.base)}/${trim(config.api.version)}/${trim(resource.resource)}`.replace(/\/+/g, "/");
    paths[basePath] = {
      get: {
        summary: `List ${resource.resource}`,
        tags: [resource.meta?.group ?? resource.resource]
      },
      post: {
        summary: `Create ${resource.resource}`,
        tags: [resource.meta?.group ?? resource.resource]
      }
    };
    paths[`${basePath}/{id}`] = {
      get: { summary: `Get ${resource.resource} by id`, tags: [resource.meta?.group ?? resource.resource] },
      put: { summary: `Update ${resource.resource}`, tags: [resource.meta?.group ?? resource.resource] },
      delete: { summary: `Delete ${resource.resource}`, tags: [resource.meta?.group ?? resource.resource] }
    };
    paths[`${basePath}/${config.realtime.sseSuffix}`] = {
      get: { summary: `SSE stream for ${resource.resource}`, tags: ["realtime"] }
    };
    paths[`${basePath}/${config.realtime.websocketSuffix}`] = {
      get: { summary: `WebSocket stream for ${resource.resource}`, tags: ["realtime"] }
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: config.name,
      version: config.api.version
    },
    paths
  };
}

export function renderDocsUi(config: ResolvedLumoraConfig): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${config.name} API Docs</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; background: #f4f0ea; color: #1b1a19; }
      pre { background: white; padding: 1rem; border-radius: 12px; overflow: auto; border: 1px solid #ddd4c7; }
      h1 { margin-bottom: 0.25rem; }
      .muted { color: #6d6256; margin-bottom: 1rem; }
    </style>
  </head>
  <body>
    <h1>${config.name} Docs</h1>
    <div class="muted">Auto-generated in development mode by Lumora.</div>
    <pre id="openapi">Loading...</pre>
    <script>
      fetch(${JSON.stringify(config.docs.openApiPath)})
        .then((response) => response.json())
        .then((json) => {
          document.getElementById("openapi").textContent = JSON.stringify(json, null, 2);
        });
    </script>
  </body>
</html>`;
}

function trim(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}
