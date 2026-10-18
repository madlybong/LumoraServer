import { OpenAPIHono, createRoute, z, idempotency, type LumoraHonoVariables } from "@astrake/lumora-server";

const customRoutes = new OpenAPIHono<{ Variables: LumoraHonoVariables }>();

const pingRoute = createRoute({
  method: "get",
  path: "/ping",
  summary: "Health ping from custom module",
  responses: {
    200: {
      description: "Pong response",
      content: {
        "application/json": {
          schema: z.object({
            ok: z.boolean(),
            data: z.object({ message: z.string() }),
            requestId: z.string()
          })
        }
      }
    }
  }
});

customRoutes.openapi(pingRoute, (c) => {
  return c.var.ok({ message: "pong from custom route!" });
});

customRoutes.post("/echo", idempotency(), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.var.created({ echoed: body });
});

export default customRoutes;
