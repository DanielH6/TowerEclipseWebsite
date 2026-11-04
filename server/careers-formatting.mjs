const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

// Persist styled text, never administrator-supplied HTML or CSS.
export function normalizeFormatting(input, fields) {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Invalid text formatting.");
  const result = {};
  for (const [field, runs] of Object.entries(input)) {
    if (!Object.hasOwn(fields, field) || !Array.isArray(runs) || runs.length > 200) fail("Invalid text formatting field or too many style changes.");
    const clean = runs.map(run => {
      if (!run || typeof run.text !== "string" || run.text.length > fields[field].length + 1000) fail("Invalid formatted text.");
      const next = { text: run.text };
      for (const mark of ["bold", "italic", "underline", "strike"]) if (run[mark] === true) next[mark] = true;
      for (const colour of ["color", "highlight"]) {
        if (run[colour] !== undefined) {
          if (typeof run[colour] !== "string" || !/^#[\da-f]{6}$/i.test(run[colour])) fail("Choose a valid text colour.");
          next[colour] = run[colour].toLowerCase();
        }
      }
      if (run.href !== undefined) {
        let url; try { url = new URL(run.href); } catch { fail("Enter a valid text link."); }
        if (!["https:", "http:", "mailto:"].includes(url.protocol) || run.href.length > 2000) fail("Text links must use http, https or mailto.");
        next.href = url.href;
      }
      if (run.size !== undefined) {
        if (!["small", "large"].includes(run.size)) fail("Choose a supported text size.");
        next.size = run.size;
      }
      return next;
    });
    // Plain fields already use trim(); trim matching runs without losing styles.
    while (clean.length) { clean[0].text = clean[0].text.trimStart(); if (clean[0].text) break; clean.shift(); }
    while (clean.length) { clean.at(-1).text = clean.at(-1).text.trimEnd(); if (clean.at(-1).text) break; clean.pop(); }
    if (clean.map(run => run.text).join("") !== fields[field]) fail("Formatted text does not match the field. Reload before saving.");
    if (Buffer.byteLength(JSON.stringify(clean), "utf8") > Buffer.byteLength(fields[field], "utf8") + 4000) fail("Too many style changes in one field. Simplify the formatting.");
    if (clean.some(run => Object.keys(run).length > 1)) result[field] = clean;
  }
  return result;
}
