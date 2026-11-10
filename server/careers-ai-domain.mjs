import { createHash } from "node:crypto";

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const text = (value, label, max, required = false) => {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(`${label}: ${required ? "enter a value, " : ""}up to ${max} characters.`);
  return value.trim();
};
export const AI_MODEL = "gpt-6-luna";
export const AI_PROMPT_VERSION = "careers-2026-11-04-v2";
export const AI_DEFAULT_REASONING_EFFORT = "medium";
// Supported review choices; prices are Standard USD per million text tokens,
// checked against the model documentation on 2026-11-10.
export const AI_MODELS = [
  { id: AI_MODEL, label: "GPT-6 Luna", inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
];
export const AI_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export function normalizeAiRunOptions(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Choose a supported AI model and reasoning effort.");
  const model = input.model === undefined ? AI_MODEL : input.model;
  const reasoningEffort = input.reasoningEffort === undefined ? AI_DEFAULT_REASONING_EFFORT : input.reasoningEffort;
  if (!AI_MODELS.some(choice => choice.id === model)) fail("Choose GPT-6 Luna or GPT-6.1 Sol for this review.");
  if (!AI_REASONING_EFFORTS.includes(reasoningEffort)) fail("Choose Low, Medium, High, Extra high or Maximum reasoning effort.");
  return { model, reasoningEffort };
}
export const emptyAiReview = () => ({ brief: "", criteria: [], examples: [] });
export function normalizeAiReview(input = emptyAiReview(), ready = false) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input), "utf8") > 100_000) fail("AI review settings must fit within 100 KB.");
  const brief = text(input.brief ?? "", "Review brief", 8000, ready);
  if (!Array.isArray(input.criteria) || input.criteria.length > 8 || (ready && !input.criteria.length)) fail("Add 1–8 scoring criteria before running a review.");
  const ids = new Set();
  const criteria = input.criteria.map(c => {
    if (!c || typeof c.id !== "string" || !/^[\w-]{1,80}$/.test(c.id) || ids.has(c.id)) fail("Scoring criteria need unique identifiers.");
    ids.add(c.id);
    if (![1, 2, 3].includes(c.weight)) fail("Choose Normal, High or Highest importance.");
    return { id: c.id, name: text(c.name, "Criterion name", 80, ready), description: text(c.description ?? "", "Criterion description", 1200, ready), weight: c.weight,
      low: text(c.low ?? "", "Low-score guidance", 500), middle: text(c.middle ?? "", "Mid-score guidance", 500), high: text(c.high ?? "", "High-score guidance", 500) };
  });
  if (!Array.isArray(input.examples) || input.examples.length > 20) fail("Use up to 20 sample answers.");
  const examples = input.examples.map(e => {
    if (!e || !Number.isInteger(e.score) || e.score < 0 || e.score > 5) fail("Sample answer scores range from 0 to 5.");
    return { question: text(e.question ?? "", "Sample question", 300), answer: text(e.answer ?? "", "Sample answer", 5000, ready), score: e.score, notes: text(e.notes ?? "", "Why this sample receives its score", 1200, ready) };
  });
  return { brief, criteria, examples };
}
export const aiFingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// The model selects source IDs instead of copying quotes. Split only to bound
// displayed excerpts; retain the original spelling, whitespace and punctuation.
function answerExcerpts(answer) {
  const excerpts = [];
  for (const value of Array.isArray(answer) ? answer : answer == null ? [] : [answer]) {
    let remaining = String(value);
    while (remaining.length) {
      let end = Math.min(300, remaining.length);
      if (end < remaining.length) {
        const whitespace = [...remaining.slice(0, end).matchAll(/\s+/g)].at(-1);
        if (whitespace && whitespace.index >= 150) end = whitespace.index + whitespace[0].length;
        // Never split a UTF-16 surrogate pair in an unbroken word/code sample.
        if (/[\uDC00-\uDFFF]/u.test(remaining[end])) end--;
      }
      const excerpt = remaining.slice(0, end).trim();
      if (excerpt) excerpts.push(excerpt);
      remaining = remaining.slice(end);
    }
  }
  return excerpts;
}
export function assessmentInput(form, application, settings) {
  let sourceId = 0;
  return { opening: { title: form.title, category: form.category, description: form.description, commitment: form.commitment }, settings,
    questions: form.questions.map(q => ({ id: q.id, type: q.type, question: q.label, help: q.help, required: q.required,
      ...(q.options ? { options: q.options } : {}), ...(q.type === "scale" ? { min: q.min, max: q.max, minLabel: q.minLabel, maxLabel: q.maxLabel } : {}),
      ...(q.image ? { imageDescription: q.image.alt } : {}), answerExcerpts: answerExcerpts(application.answers[q.id]).map(text => ({ id: `a${++sourceId}`, text })) })) };
}
export function normalizeAssessment(input, settings, form, application) {
  if (!input || !Array.isArray(input.grades) || input.grades.length !== settings.criteria.length) fail("The AI returned an incomplete assessment.");
  const known = new Map(settings.criteria.map(c => [c.id, c])), seen = new Set();
  const sources = new Map(assessmentInput(form, application, settings).questions.flatMap(q => q.answerExcerpts.map(excerpt => [excerpt.id, { questionId: q.id, question: q.question, quote: excerpt.text }])));
  const grades = input.grades.map(grade => {
    const criterion = known.get(grade.criterionId);
    if (!criterion || seen.has(grade.criterionId) || typeof grade.score !== "number" || !Number.isFinite(grade.score) || grade.score < 0 || grade.score > 5) fail("The AI returned an invalid criterion score.");
    seen.add(grade.criterionId);
    if (!Array.isArray(grade.evidence) || grade.evidence.length > 3) fail("The AI returned invalid supporting evidence.");
    const evidence = [...new Set(grade.evidence)].map(id => {
      const source = sources.get(id);
      if (!source) fail("Luna returned an unknown answer reference. No new ranking was applied.");
      return source;
    });
    return { criterionId: criterion.id, name: criterion.name, weight: criterion.weight, score: grade.score, explanation: text(grade.explanation, "Criterion explanation", 1200, true), evidence };
  });
  const qualityScore = Math.round(100 * grades.reduce((sum, g) => sum + g.score * g.weight, 0) / settings.criteria.reduce((sum, c) => sum + c.weight, 0)) / 50;
  return { qualityScore, summary: text(input.summary, "Assessment summary", 1500, true), observations: text(input.observations ?? "", "Additional observations", 1500), grades };
}
// Acklam's inverse normal approximation; used only for relative cohort display.
function normalQuantile(p) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-.00778489400243029, -.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [.00778469570904146, .32246712907004, 2.445134137143, 3.75440866190742];
  if (p < .02425 || p > .97575) {
    const q = Math.sqrt(-2 * Math.log(p < .5 ? p : 1 - p));
    const value = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    return p < .5 ? value : -value;
  }
  const q = p - .5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
export function rankAssessments(items) {
  const sorted = [...items].sort((a, b) => a.qualityScore - b.qualityScore || a.id.localeCompare(b.id));
  const positions = sorted.map((_, i) => Math.max(0, Math.min(10, 5 + 2 * normalQuantile((i + .5) / sorted.length))));
  const ranked = [];
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].qualityScore === sorted[start].qualityScore) end++;
    // Average the positions occupied by a tied group. This preserves an exact
    // mean of five before display rounding, without inventing tie-break grades.
    const relativeScore = positions.slice(start, end).reduce((a, b) => a + b, 0) / (end - start);
    for (let i = start; i < end; i++) ranked.push({ ...sorted[i], relativeScore, rank: sorted.length - end + 1, poolSize: sorted.length });
    start = end;
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}
