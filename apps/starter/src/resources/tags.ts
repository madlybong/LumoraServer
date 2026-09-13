import { defineResource } from "@astrake/lumora-server";

export default defineResource({
  resource: "tags",
  fields: {
    name: { type: "string", required: true, unique: true, searchable: true },
    color: { type: "string", default: "#000000" }
  },
  computed: {
    slug: {
      type: "string",
      resolve: (r) => (r.name as string).toLowerCase().replace(/[^a-z0-9]+/g, "-")
    }
  },
  query: { defaultPageSize: 50 }
});
