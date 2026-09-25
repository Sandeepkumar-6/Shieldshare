import { z } from 'zod';

// api-contract.md §1: ?page=1&limit=20&sort=-createdAt; limit max 100.
export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export function paginate({ page, limit }) {
  return { skip: (page - 1) * limit, limit };
}

export function pageMeta({ page, limit }, total) {
  return { page, limit, total };
}

// Turns "-createdAt" into { createdAt: -1 } when the field is whitelisted.
export function parseSort(sort, allowed, fallback) {
  const value = sort || fallback;
  const descending = value.startsWith('-');
  const field = descending ? value.slice(1) : value;
  if (!allowed.includes(field)) {
    return null;
  }
  return { [field]: descending ? -1 : 1, _id: descending ? -1 : 1 };
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
