// Record validation (F-10, F-18), source checks, and the Retain/Discard filter (F-6, F-2 duplicate rule).
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT, SEED_FILE } from "../src/config.mjs";
import { tsOf, validateRecord, checkSource, sourcePathProblem } from "../src/record.mjs";
import { evaluate } from "../src/retain.mjs";

const made = [];
const tmpDir = prefix => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const good = (over = {}) => ({
  id: "mem-test-1", namespace: "ns:main:dev", feature: 1, type_tag: "fact", status: "current",
  source_task: "t", source_path: "AGENTS.md", timestamp: "2026-11-11", importance: 2,
  summary: "A plain, checkable statement about how the booking calendar works for a technician.", ...over,
});
const verdict = (over, existing = []) => evaluate(good(over), { existing, repoRoot: REPO_ROOT });
const why = v => v.reasons.join(" | ");

describe("tsOf rejects impossible dates (F-10)", () => {
  it("accepts real dates, including a leap day", () => {
    assert.equal(tsOf("2026-11-12"), 20261112);
    assert.equal(tsOf("2024-02-29"), 20240229);
    assert.equal(tsOf("2026-12-31"), 20261231);
    assert.equal(tsOf("2026-01-01"), 20260101);
  });
  it("rejects months, days and leap days that do not exist", () => {
    for (const bad of ["2026-13-45", "2026-02-30", "2026-02-29", "2026-00-10", "2026-04-31", "2026-01-00", "2026-13-01", "0050-01-01"]) {
      assert.throws(() => tsOf(bad), /bad date/, bad);
    }
  });
  it("rejects the wrong shape", () => {
    for (const bad of ["2026-1-1", "garbage", "", undefined, null, "2026-11-12T10:00", " 2026-11-12"]) assert.throws(() => tsOf(bad), /bad date/, String(bad));
  });
  it("validateRecord reports an impossible timestamp", () => {
    assert.match(validateRecord(good({ timestamp: "2026-02-30" })).join(), /bad date/);
  });
});

describe("validateRecord (F-18)", () => {
  it("a good record has no problems", () => assert.deepEqual(validateRecord(good()), []));

  it("summary must be a string", () => {
    for (const summary of [12345, { a: 1 }, ["text"], true]) assert.match(validateRecord(good({ summary })).join(), /summary must be a string/, JSON.stringify(summary));
  });

  it("id: letters, digits and . _ : - only, starting with a letter or digit, at most 100", () => {
    for (const id of ["mem-x-f1-a_b", "A1", "mem:x.y-z", "9lives", "a".repeat(100)]) assert.deepEqual(validateRecord(good({ id })), [], id);
    for (const id of ["../../x", "a/b", "a\\b", "-leading", ".hidden", "has space", "a..b", "x".repeat(101), "caf\u00e9", 42]) {
      assert.match(validateRecord(good({ id })).join(), /bad id/, String(id));
    }
  });

  it("source_path must be relative, with forward slashes, and stay out of .git and node_modules", () => {
    for (const sp of ["AGENTS.md", "AGENTS.md#coding-conventions", "pipeline/rules/booking-conflicts.md", "pipeline/memory/x.md#a-b"]) {
      assert.deepEqual(validateRecord(good({ source_path: sp })), [], sp);
    }
    const bad = {
      "pipeline\\rules\\x.md": /forward slashes/,
      "pipeline\\rules/x.md#a": /forward slashes/,
      [path.join(REPO_ROOT, "AGENTS.md")]: /relative|forward slashes/,
      "/etc/passwd": /relative/,
      "C:/Windows/win.ini": /relative/,
      "c:\\Windows\\win.ini": /forward slashes|relative/,
      "../outside.md": /\.\./,
      "pipeline/../../x.md": /\.\./,
      ".git/config": /\.git/,
      ".git": /\.git/,
      "node_modules/x/readme.md": /node_modules/,
      "frontend/node_modules/x/readme.md": /node_modules/,
      "AGENTS.md#": /empty anchor/,
      "AGENTS.md#a#b": /more than one/,
    };
    for (const [sp, re] of Object.entries(bad)) assert.match(validateRecord(good({ source_path: sp })).join(), re, sp);
    assert.match(sourcePathProblem(42), /string/);
  });

  it("a Windows-style path and an absolute path are refused by the whole filter, not only by validateRecord", () => {
    assert.equal(verdict({ source_path: "pipeline\\rules\\booking-conflicts.md" }).retain, false);
    assert.equal(verdict({ source_path: path.join(REPO_ROOT, "AGENTS.md") }).retain, false);
    assert.equal(verdict({ source_path: "AGENTS.md" }).retain, true);
  });

  it("a record that is not an object is refused", () => {
    for (const r of [null, undefined, "x", 5]) assert.deepEqual(validateRecord(r), ["record is not an object"]);
  });
});

describe("checkSource: the file and the anchor must really exist", () => {
  it("accepts a real file and a real anchor", () => {
    assert.equal(checkSource("AGENTS.md", REPO_ROOT), "");
    assert.equal(checkSource("AGENTS.md#coding-conventions", REPO_ROOT), "");
  });
  it("refuses a missing file, a directory, a missing anchor and a wrong-case anchor", () => {
    assert.match(checkSource("no/such/file.md", REPO_ROOT), /source file not found/);
    assert.match(checkSource("pipeline", REPO_ROOT), /source file not found/);
    assert.match(checkSource("AGENTS.md#no-such-heading", REPO_ROOT), /anchor not found/);
    assert.match(checkSource("AGENTS.md#Coding-Conventions", REPO_ROOT), /anchor not found/);
  });
  it("refuses a path that leaves the repo, including a sibling folder that shares the repo's name as a prefix", () => {
    assert.match(checkSource("../../../etc/hosts", REPO_ROOT), /leaves the repo/);
    assert.match(checkSource("..", REPO_ROOT), /leaves the repo/);
    const parent = tmpDir("memtest-sib-");
    const repo = path.join(parent, "repo");
    const evil = path.join(parent, "repo-evil");
    fs.mkdirSync(repo); fs.mkdirSync(evil);
    fs.writeFileSync(path.join(evil, "x.md"), "# Heading\n");
    fs.writeFileSync(path.join(repo, "ok.md"), "# Heading\n");
    assert.match(checkSource("../repo-evil/x.md", repo), /leaves the repo/);
    assert.match(checkSource(path.join(evil, "x.md"), repo), /leaves the repo/);
    assert.equal(checkSource("ok.md#heading", repo), "");
  });
});

describe("Retain/Discard: logs, exceptions, JSON, tokens, personal data and guesses (F-6)", () => {
  const reject = (summary, re) => {
    const v = verdict({ summary });
    assert.equal(v.retain, false, `kept: ${summary}`);
    assert.match(why(v), re, summary);
  };

  it("a log line on any line of the summary is refused, not only the first", () => {
    const first = "The booking service rejects a job that overlaps another job for the same technician.";
    reject(`${first}\n[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin`, /raw output/);
    reject(`${first}\n[INFO] BUILD SUCCESS`, /raw output/);
    reject(`${first}\r\nTests run: 12, Failures: 0, Errors: 0, Skipped: 0`, /raw output/);
    reject(`${first}\n    at com.serviceforge.service.TechnicianAvailabilityService.bookJob(TechnicianAvailabilityService.java:88)`, /raw output/);
    reject(`${first}\n2026-11-11T10:15:00 INFO started Tomcat`, /raw output/);
    reject(`${first}\nstderr: something went wrong in the run`, /raw output/);
  });

  it("log level without brackets, and Java exception lines, are refused", () => {
    reject("ERROR com.serviceforge.service.TechnicianAvailabilityService failed while booking the job", /raw output/);
    reject("WARN  c.s.controller.JobController slow request for the booking endpoint today", /raw output/);
    reject("java.lang.NullPointerException: Cannot invoke String.length() because the value is null", /raw output/);
    reject("Caused by: org.springframework.web.HttpMessageNotReadableException: JSON parse error in the body", /raw output/);
    reject("The booking call failed.\nio.netty.handler.timeout.ReadTimeoutError: read timed out after 30 s", /raw output/);
  });

  it("a JSON body is refused", () => {
    reject('{"timestamp":"2026-11-12T07:16:03.812+00:00","status":400,"error":"Bad Request","path":"/api/jobs"}', /raw output/);
    reject('[{"id":1,"name":"Filter"},{"id":2,"name":"Belt"},{"id":3,"name":"Valve"}]', /raw output/);
  });

  it("an Authorization header, a Bearer token and an AWS access key are refused", () => {
    reject("Call the endpoint with Authorization: Bearer abc and the request goes through fine.", /secret/);
    reject("The calendar sync call uses Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 as its credential.", /secret/);
    reject("The deploy user has the access key AKIAIOSFODNN7EXAMPLE configured in the build.", /secret/);
  });

  it("an e-mail address is refused", () => {
    reject("The booking owner is jane.doe@example.com and she approves every calendar change.", /personal data/);
  });

  it("hedged guesses are refused", () => {
    for (const hedge of ["I think", "i guess", "not sure", "Maybe", "probably"]) {
      reject(`${hedge} the travel buffer applies to every booked job on a technician calendar.`, /hedged guess/);
    }
    reject("The travel buffer is probably 45 minutes for each booked job on the calendar.", /hedged guess/);
  });

  it("words that only contain a hedge or a noise word as part of another word are not refused", () => {
    assert.equal(verdict({ summary: "Every 4xx response must carry an ApiError body. Request-level 400 mapping lives in one shared handler." }).retain, true);
    assert.equal(verdict({ summary: "The permaybe is not a word, and 'thinking' is fine: buffers apply to every booked job." }).retain, true);
  });

  it("the existing noise, chatter and secret patterns still work", () => {
    reject("[INFO] BUILD SUCCESS in 4.2 s for module backend", /raw output/);
    reject("Sure, let me look at that file and get back to you with the result shortly.", /chatter/);
    reject("The service uses api_key=sk-abcdefghijklmnop1234 for the calendar sync call", /secret/);
    reject("-----BEGIN RSA PRIVATE KEY----- is stored next to the calendar service config file", /secret/);
  });

  it("every seed record still passes the filter", () => {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8")).records;
    for (const r of seed) {
      const v = evaluate(r, { existing: [], repoRoot: REPO_ROOT });
      assert.deepEqual([r.id, v.reasons], [r.id, []]);
    }
  });
});

describe("Retain/Discard: length and duplicates", () => {
  it("summary length: 24 refused, 25 kept, 600 kept, 601 refused", () => {
    const of = n => "abcd efgh ".repeat(Math.ceil(n / 10)).slice(0, n).replace(/ $/, "x");
    assert.equal(verdict({ summary: of(24) }).retain, false);
    assert.equal(verdict({ summary: of(25) }).retain, true);
    assert.equal(verdict({ summary: of(600) }).retain, true);
    const v = verdict({ summary: of(601) });
    assert.equal(v.retain, false);
    assert.match(why(v), /over 600 characters/);
  });

  it("a duplicate of a current record in the same namespace is refused", () => {
    const old = good({ id: "mem-old" });
    const v = verdict({ id: "mem-new" }, [old]);
    assert.equal(v.retain, false);
    assert.match(why(v), /duplicate of mem-old/);
  });

  it("a superseded record does not block its replacement (a renamed section)", () => {
    const old = good({ id: "mem-old", status: "superseded" });
    assert.equal(verdict({ id: "mem-new" }, [old]).retain, true);
  });

  it("the same id is an update, and a record in another namespace is not a duplicate", () => {
    const old = good({ id: "mem-same" });
    assert.equal(verdict({ id: "mem-same" }, [old]).retain, true);
    assert.equal(verdict({ id: "mem-new", namespace: "other:main:dev" }, [old]).retain, true);
  });
});
