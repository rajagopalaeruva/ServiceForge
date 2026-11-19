import { tsOf } from "./record.mjs";

/**
 * The hard filters from memory-architecture.md, sections 5 and 7.2.
 * Every store applies these inside its own query. The core applies them
 * again to whatever a store returns, so a store that forgets a filter
 * cannot leak records into the injected block.
 *
 * filters = { namespace, asOf: 'YYYY-MM-DD', features: [1,'all'], includeHistory: false }
 */
export function passes(record, filters) {
  if (record.namespace !== filters.namespace) return false;
  if (record.ts > tsOf(filters.asOf)) return false;
  if (!filters.features.includes(record.feature)) return false;
  if (!filters.includeHistory && record.status === "superseded") return false;
  return true;
}

export function whyRejected(record, filters) {
  if (record.namespace !== filters.namespace) return "namespace";
  if (record.ts > tsOf(filters.asOf)) return "after as_of";
  if (!filters.features.includes(record.feature)) return "feature";
  if (!filters.includeHistory && record.status === "superseded") return "superseded";
  return "";
}
