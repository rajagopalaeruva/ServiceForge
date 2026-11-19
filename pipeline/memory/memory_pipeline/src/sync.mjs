// Write path, step 2: bring a store in line with the extracted candidates, writing only what changed.
// Idempotent. Never deletes: a record whose source section disappeared is kept, marked `superseded` with a
// `stale_reason`, so the default read path drops it and includeHistory still shows it (finding F-2).
import { ingest } from "./retain.mjs";
import { keyOf } from "./record.mjs";

export const STALE_REASON = "source section no longer found";

/** Compares candidates with the store by namespace + id and source_hash. Writes nothing. */
export async function plan(store, candidates, { namespace } = {}) {
  const existing = await store.all();
  const byKey = new Map(existing.map(r => [keyOf(r), r]));
  const added = [], changed = [], unchanged = [];
  for (const c of candidates) {
    const old = byKey.get(keyOf(c));
    if (!old) added.push(c);
    // A record that was marked stale and whose section is back is rewritten from the candidate.
    else if (old.source_hash !== c.source_hash || old.stale_reason) changed.push(c);
    else unchanged.push(c.id);
  }
  const ns = namespace ?? candidates[0]?.namespace;
  const keep = new Set(candidates.map(keyOf));
  // Only records of the extracted namespace, written by the extractor, not already marked stale.
  const removed = ns === undefined ? [] : existing.filter(r =>
    r.origin === "extract" && r.namespace === ns && !keep.has(keyOf(r)) && !r.stale_reason);
  return { added, changed, unchanged, removed };
}

/**
 * Marks stale records first (so a renamed section's new record is not discarded as a duplicate of the old one),
 * then writes added and changed candidates through the Retain/Discard filter.
 * result.removed lists the ids of records newly marked superseded.
 */
export async function sync(store, candidates, { repoRoot, dryRun = false, namespace } = {}) {
  const p = await plan(store, candidates, { namespace });
  const result = {
    added: p.added.map(c => c.id), changed: p.changed.map(c => c.id),
    unchanged: p.unchanged.length, removed: p.removed.map(r => r.id), written: [], discarded: [],
  };
  if (dryRun) return result;
  // Written directly: the Retain/Discard filter would refuse these records, because their anchor is gone.
  for (const r of p.removed) await store.write({ ...r, status: "superseded", stale_reason: STALE_REASON });
  if (p.added.length === 0 && p.changed.length === 0) return result;
  const res = await ingest(store, [...p.added, ...p.changed], { repoRoot });
  result.written = res.written;
  result.discarded = res.discarded;
  return result;
}

/** True when the store differs from the sources: something to add, change or mark stale. */
export const hasDrift = r => r.added.length > 0 || r.changed.length > 0 || r.removed.length > 0;
