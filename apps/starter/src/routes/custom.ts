import { Hono } from "hono";

const customRoutes = new Hono();

customRoutes.get("/ping", (c) => {
  return c.json({ message: "pong from custom route!" });
});

export default customRoutes;
