import type { Context } from "hono";

export interface PaginationOptions {
  page: number;
  pageSize: number;
}

export function parsePagination(
  c: Context,
  defaultPageSize = 20,
  maxPageSize = 100
): PaginationOptions {
  const page = Number(c.req.query("page") ?? 1);
  const rawPageSize = c.req.query("pageSize") ?? c.req.query("limit");
  const pageSize = Math.min(
    Number(rawPageSize ?? defaultPageSize),
    maxPageSize
  );
  return { page: Math.max(1, page), pageSize: Math.max(1, pageSize) };
}

export interface PaginatedList<T> {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  nextCursor?: string;
  [key: string]: unknown;
}

export function paginated<T>(
  rows: T[],
  meta: { total: number; page: number; pageSize: number; nextCursor?: string; [key: string]: unknown }
): PaginatedList<T> {
  const totalPages = meta.pageSize > 0 ? Math.ceil(meta.total / meta.pageSize) : 0;
  const hasNextPage = meta.page < totalPages;
  return {
    ...meta,
    totalPages,
    hasNextPage,
  };
}
