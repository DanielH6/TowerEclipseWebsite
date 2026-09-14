export const QUESTION_TYPES = ["short", "paragraph", "choice", "checkboxes", "ranking", "scale"];
export const APPLICATION_STATUSES = ["submitted", "under_review", "shortlisted", "accepted", "rejected", "withdrawn"];
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function identifier(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail("Invalid identifier.");
  return value;
}
function text(value, label, max, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(`${label}: ${required ? "enter a value, " : ""}up to ${max} characters.`);
  return value.trim();
}
export function normalizeForm(input, publishing = false) {
  if (!input || typeof input !== "object") fail("Enter a form.");
  const title = text(input.title, "Title", 100, true);
  const category = text(input.category, "Category", 60, true);
  const description = text(input.description, "Description", 4000, publishing);
  const commitment = text(input.commitment ?? "", "Commitment", 150);
  const confirmation = text(input.confirmation ?? "", "Confirmation message", 1000);
  let closesAt = null;
  if (input.closesAt) {
    if (typeof input.closesAt !== "string" || !Number.isFinite(Date.parse(input.closesAt))) fail("Choose a valid closing date.");
    closesAt = new Date(input.closesAt).toISOString();
  }
  if (!Array.isArray(input.questions) || input.questions.length > 40 || (publishing && !input.questions.length)) fail("Add between 1 and 40 questions before publishing.");
  const ids = new Set();
  const questions = input.questions.map((q, index) => {
    identifier(q?.id);
    if (ids.has(q.id)) fail("Question identifiers must be unique.");
    ids.add(q.id);
    if (!QUESTION_TYPES.includes(q.type)) fail("Unsupported question type.");
    const question = { id: q.id, type: q.type, label: text(q.label, `Question ${index + 1}`, 300, publishing), help: text(q.help ?? "", "Question help", 800), required: q.required === true };
    if (["choice", "checkboxes", "ranking"].includes(q.type)) {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 15) fail("Choice and ranking questions need 2–15 options.");
      question.options = q.options.map(option => text(option, "Option", 150, true));
      if (new Set(question.options).size !== question.options.length) fail("Options must be unique.");
    }
    if (q.type === "scale") {
      if (![0, 1].includes(q.min) || !Number.isInteger(q.max) || q.max < 2 || q.max > 10) fail("Scales start at 0 or 1 and end between 2 and 10.");
      Object.assign(question, { min: q.min, max: q.max, minLabel: text(q.minLabel ?? "", "Low label", 80), maxLabel: text(q.maxLabel ?? "", "High label", 80) });
    }
    return question;
  });
  return { title, category, description, commitment, confirmation, closesAt, questions };
}
export function validateAnswers(form, answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers) || Buffer.byteLength(JSON.stringify(answers), "utf8") > 64_000) fail("Answers must fit within 64 KB.");
  const known = new Set(form.questions.map(q => q.id));
  if (Object.keys(answers).some(key => !known.has(key))) fail("The form has changed. Reload it before submitting.", 409);
  const clean = {};
  for (const q of form.questions) {
    const value = answers[q.id];
    const empty = value == null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length);
    if (empty) { if (q.required) fail(`Please answer: ${q.label}`); continue; }
    if (q.type === "short" || q.type === "paragraph") clean[q.id] = text(value, q.label, q.type === "short" ? 500 : 5000, true);
    else if (q.type === "choice") {
      if (!q.options.includes(value)) fail(`Choose a listed option: ${q.label}`);
      clean[q.id] = value;
    } else if (q.type === "scale") {
      if (!Number.isInteger(value) || value < q.min || value > q.max) fail(`Choose a value on the scale: ${q.label}`);
      clean[q.id] = value;
    } else {
      if (!Array.isArray(value) || value.some(option => !q.options.includes(option)) || new Set(value).size !== value.length || (q.type === "ranking" && value.length !== q.options.length)) fail(`Choose ${q.type === "ranking" ? "each option exactly once" : "listed options"}: ${q.label}`);
      clean[q.id] = [...value];
    }
  }
  return clean;
}
export function reviewInput(input) {
  if (!APPLICATION_STATUSES.includes(input?.status) || input.status === "withdrawn") fail("Choose a review status.");
  return { status: input.status, feedback: text(input.feedback, "Applicant feedback", 2000), internalNotes: text(input.internalNotes, "Private notes", 6000) };
}
