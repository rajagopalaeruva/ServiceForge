// Write path, step 2: bring a store in line with the extracted candidates, writing only what changed.
// Idempotent. Never deletes: a record whose source section disappeared is only reported as removed.
import { ingest } from "./retain.mjs";

/** Compares candidates with the store by id and source_hash. Writes nothing. */
export async function plan(store, candidates) {
  const existing = await store.all();
  const byId = new Map(existing.map(r => [r.id, r]));
  const added = [], changed = [], unchanged = [];
  for (const c of candidates) {
    const old = byId.get(c.id);
    if (!old) added.push(c);
    else if (old.source_hash !== c.source_hash) changed.push(c);
    else unchanged.push(c.id);
  }
  const keep = new Set(candidates.map(c => c.id));
  const removed = existing.filter(r => r.origin === "extract" && !keep.has(r.id)).map(r => r.id);
  return { added, changed, unchanged, removed };
}

/** Writes added and changed candidates through the Retain/Discard filter. */
export async function sync(store, candidates, { repoRoot, dryRun = false }) {
  const p = await plan(store, candidates);
  const result = {
    added: p.added.map(c => c.id), changed: p.changed.map(c => c.id),
    unchanged: p.unchanged.length, removed: p.removed, written: [], discarded: [],
  };
  if (dryRun || (p.added.length === 0 && p.changed.length === 0)) return result;
  const res = await ingest(store, [...p.added, ...p.changed], { repoRoot });
  result.written = res.written;
  result.discarded = res.discarded;
  return result;
}
