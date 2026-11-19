// Stop-hook entry point (M-9). Must return at once and never fail the session.
// It drains the hook's STDIN payload (session_id, hook_event_name, cwd; no turn content, see hook-probe-findings.md),
// starts the real work as a detached process, and exits 0. Output is never printed.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), "sync-run.mjs");

try {
  process.stdin.on("error", () => {});
  process.stdin.resume();                     // drain and ignore the payload
  const child = spawn(process.execPath, [worker], { detached: true, stdio: "ignore", windowsHide: true, env: process.env });
  child.on("error", () => {});
  child.unref();
} catch { /* a hook must never break the turn */ }

// Leave as soon as the child is started; do not wait for STDIN to close.
setTimeout(() => process.exit(0), 150).unref?.();
setImmediate(() => process.exit(0));
