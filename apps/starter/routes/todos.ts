import { defineResource } from "@astrake/lumora-server";

export default defineResource({
  resource: "todos",
  fields: {
    title:       { type: "string",   required: true,  searchable: true, sortable: true },
    description: { type: "string",   searchable: true },
    done:        { type: "boolean",  default: false,  filterable: true, sortable: true },
    priority:    { type: "number",   filterable: true, sortable: true },
    due_at:      { type: "datetime", filterable: true, sortable: true },
    metadata:    { type: "json"    },
    attachment:  { type: "file",     fileOptions: { accept: ["image/*", ".pdf"], maxSize: "5MB" } },
    tag_id:      { type: "string",   filterable: true },
  },
  computed: {
    is_overdue: {
      type: "boolean",
      resolve: (r) => !!r.due_at && !r.done && new Date(r.due_at as string) < new Date(),
    },
  },
  relations: {
    tag: { resource: "tags", foreignKey: "tag_id", type: "belongsTo" },
  },
  audit: true,
  bulk: { transactional: true },
  export: { csv: true },
  auth: { mode: "inherit" },
  query: { defaultPageSize: 20, maxPageSize: 100 },
});
