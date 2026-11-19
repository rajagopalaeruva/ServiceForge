// Shared text helpers.
const STOP = new Set(("a an and are as at be by for from has have how in is it its of on or that the this to was were will with " +
  "must may can not no do does into per than then their there these those which who what when where why one two").split(" "));

/** Lower-cased significant words, with a crude plural strip. Used for keyword scoring and for keywords derived from headings. */
export function terms(text) {
  const out = new Set();
  for (const w of String(text).toLowerCase().split(/[^a-z0-9_]+/)) {
    if (!w || STOP.has(w)) continue;
    const stem = w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w;
    out.add(stem);
  }
  return out;
}
