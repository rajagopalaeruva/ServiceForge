// The relevance key is the AUTHOR'S JUDGMENT, not ground truth. Q1 follows the spec's dependencies DEP-1..DEP-3;
// Q2 to Q4 are judged from the record texts. Used by scaling.mjs and floor.mjs.
import { TASK_QUERY } from "../test/contract.mjs";

export const QUERIES = [
  { n: "Q1 F2 task",         text: TASK_QUERY,
    relevant: ["mem-f1-buffered-interval", "mem-f1-buffer-45", "mem-rule-booking-conflicts"] },
  { n: "Q2 time between jobs", text: "how much time must separate two jobs for one technician",
    relevant: ["mem-f1-buffer-45", "mem-f1-buffered-interval", "mem-rule-booking-conflicts"] },
  { n: "Q3 finished job",    text: "can a part be reserved for a job that is already finished",
    relevant: ["mem-bug-004"] },
  { n: "Q4 overlap check",   text: "overlap check",
    relevant: ["mem-bug-001", "mem-f1-buffered-interval", "mem-rule-booking-conflicts"] },
];
