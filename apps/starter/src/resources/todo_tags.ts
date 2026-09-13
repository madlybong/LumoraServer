import { defineResource } from "@astrake/lumora-server";

export default defineResource({
  resource: "todo_tags",
  fields: {
    todo_id: { type: "string", required: true, filterable: true },
    tag_id: { type: "string", required: true, filterable: true }
  },
  relations: {
    todo: { resource: "todos", foreignKey: "todo_id", type: "belongsTo" },
    tag: { resource: "tags", foreignKey: "tag_id", type: "belongsTo" }
  }
});
