import type { Resource } from "../types/resource";

export type LibraryCard = Pick<Resource, "id" | "title" | "url" | "language" | "type">;

// Resource IDs are hexadecimal URL digests. Keep older non-hex IDs reachable too.
export function libraryShard(id: string): string {
  const first = id.charAt(0).toLowerCase();
  return /^[a-f0-9]$/.test(first) ? first : "other";
}
