// Owner-checked lock file for the sync writers (finding F-15).
// The lock file holds a unique token. Only the worker that wrote the token may delete the file.
// A stale lock is taken over by renaming it to a private name first (rename is atomic, so only one worker wins),
// then checking that what was renamed is really the stale lock and not a fresh one created in between.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const readToken = file => { try { return fs.readFileSync(file, "utf8"); } catch { return null; } };

/**
 * Tries to take the lock. Returns the owner token, or null when another worker holds a fresh lock.
 * onStale(ageMs) is called when a stale lock was removed.
 */
export function takeLock(file, { maxAgeMs, onStale } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = `${process.pid}:${crypto.randomBytes(8).toString("hex")}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { fs.writeFileSync(file, token, { flag: "wx" }); return token; } catch { /* exists, look at it */ }

    let age, seen;
    try { age = Date.now() - fs.statSync(file).mtimeMs; seen = readToken(file); } catch { continue; }   // vanished: retry
    if (age < maxAgeMs) return null;

    const mine = `${file}.stale-${token.replace(":", "-")}`;
    try { fs.renameSync(file, mine); } catch { continue; }                 // another worker took it over first
    const got = readToken(mine);
    if (got === seen) {
      try { fs.rmSync(mine); } catch { /* leave it */ }
      onStale?.(age);
    } else {
      // We moved a lock that is not the one we judged stale (a worker created a fresh one in between). Put it back
      // without overwriting anything (link fails if the name is taken), then give up this round.
      try { fs.linkSync(mine, file); } catch { /* a newer lock already exists */ }
      try { fs.rmSync(mine); } catch { /* leave it */ }
      return null;
    }
  }
  return null;
}

/** Deletes the lock only if it still holds this owner's token. Returns true when it was deleted. */
export function releaseLock(file, token) {
  if (!token || readToken(file) !== token) return false;
  try { fs.rmSync(file); return true; } catch { return false; }
}
