import { defineResource } from "@astrake/lumora-server";

export default defineResource({
  resource: "company",
  meta: {
    title: "Company",
    description: "Starter company resource for generated CRUD and realtime endpoints.",
    group: "Business",
    admin: {
      hidden: false,
      icon: "building"
    }
  },
  fields: {
    name: {
      type: "string",
      required: true,
      filterable: true,
      sortable: true,
      description: "Company name"
    },
    domain: {
      type: "string",
      filterable: true,
      sortable: true,
      description: "Primary web domain"
    },
    active: {
      type: "boolean",
      default: true,
      filterable: true,
      sortable: true,
      description: "Whether the company is active"
    },
    profile: {
      type: "json",
      description: "Additional JSON profile metadata"
    }
  },
  auth: {
    mode: "inherit"
  },
  query: {
    defaultPageSize: 20,
    maxPageSize: 100,
    filterable: ["name", "domain", "active"],
    sortable: ["name", "domain", "active"]
  }
});
