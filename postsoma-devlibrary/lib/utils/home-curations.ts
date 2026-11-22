import { getResourceIntent } from "./intent";

interface Candidate {
  id: string;
  type: string;
  language: string;
  collection?: string;
  tags?: string[];
  url?: string;
}

/** A bounded, bilingual pool for the homepage; the full catalog stays in search. */
export function selectHomeCurations<T extends Candidate>(
  resources: T[],
  surpriseIds: Set<string>,
): T[] {
  const groups = new Map<string, T[]>();
  for (const resource of resources) {
    const intent = getResourceIntent(resource);
    if (intent) {
      const key = `${intent}:${resource.language}`;
      const group = groups.get(key) ?? [];
      group.push(resource);
      groups.set(key, group);
    }
  }
  const selected = new Map<string, T>();
  for (const group of groups.values()) {
    // Evenly sample across the catalog rather than favoring its first category.
    const count = Math.min(12, group.length);
    for (let i = 0; i < count; i++) {
      const resource = group[Math.floor(i * group.length / count)];
      selected.set(resource.id, resource);
    }
  }
  for (const resource of resources.filter(r => surpriseIds.has(r.id)).slice(0, 24)) {
    selected.set(resource.id, resource);
  }
  return [...selected.values()];
}
