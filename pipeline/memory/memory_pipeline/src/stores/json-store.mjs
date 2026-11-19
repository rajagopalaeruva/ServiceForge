// JSON file store with keyword scoring (MEM-ADR-001). Reached only through write/query/all/reset.
import fs from "node:fs";
import path from "node:path";
import { passes } from "../filters.mjs";
import { validateRecord } from "../record.mjs";
import { terms } from "../text.mjs";

export { terms };

export class JsonStore {
  constructor(file) { this.file = file; }

  _load() {
    if (!fs.existsSync(this.file)) return [];
    return JSON.parse(fs.readFileSync(this.file, "utf8")).records ?? [];
  }

  _save(records) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ records }, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, this.file);
  }

  async all() { return this._load(); }

  async reset() { this._save([]); }

  /** Upsert by id. Safe to call twice with the same record. */
  async write(record) {
    const problems = validateRecord(record);
    if (problems.length) throw new Error(`invalid record ${record?.id}: ${problems.join("; ")}`);
    const records = this._load().filter(r => r.id !== record.id);
    records.push(record);
    this._save(records);
  }

  /** Filter, then score by the share of query terms found in summary + keywords. */
  async query(filters, text, limit = 10) {
    const q = terms(text);
    if (q.size === 0) return [];
    const scored = [];
    for (const record of this._load()) {
      if (!passes(record, filters)) continue;
      const doc = terms(`${record.summary} ${(record.keywords ?? []).join(" ")}`);
      let hit = 0;
      for (const t of q) if (doc.has(t)) hit++;
      scored.push({ record, raw: hit / q.size });
    }
    return scored.sort((a, b) => b.raw - a.raw || a.record.id.localeCompare(b.record.id)).slice(0, limit);
  }
}
