export const LIST_LIMIT = 50;

export const DIFFICULTIES = [
  { name: "Effortless", minimum: 0, color: "#b6f5b0", range: "0.0–0.9" },
  { name: "Easy", minimum: 1, color: "#6ddd88", range: "1.0–1.9" },
  { name: "Normal", minimum: 2, color: "#f3db69", range: "2.0–2.9" },
  { name: "Hard", minimum: 3, color: "#ffa360", range: "3.0–3.9" },
  { name: "Challenging", minimum: 4, color: "#ff777e", range: "4.0–4.9" },
  { name: "Insane", minimum: 5, color: "#f997d2", range: "5.0–5.9" },
  { name: "Extreme", minimum: 6, color: "#71b8ff", range: "6.0–6.9" },
  { name: "Nightmare", minimum: 7, color: "#b49aff", range: "7.0–7.9" },
  { name: "Eclipse", minimum: 8, color: "#eedaff", range: "8.0+" },
];
export const DIFFICULTY_TIERS = [
  { name: "Baseline", minimum: 0, range: ".0" },
  { name: "Low", minimum: 1, range: ".1–.3" },
  { name: "Mid", minimum: 4, range: ".4–.6" },
  { name: "High", minimum: 7, range: ".7–.8" },
  { name: "Peak", minimum: 9, range: ".9" },
];

export function difficultyRating(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 10))) return null;
  const tenths = Math.round(value * 10);
  const rating = tenths / 10;
  const difficulty = DIFFICULTIES[Math.min(Math.floor(rating), 8)];
  const tier = DIFFICULTY_TIERS.findLast(item => tenths % 10 >= item.minimum).name;
  return { ...difficulty, rating, tier, label: `${tier} ${difficulty.name}`, eclipse: rating >= 8 };
}

export const ACHIEVEMENT_FIELDS = ["name", "difficulty", "verifier", "requirements", "videoUrl", "verifiedOn", "verifiedVersion", "thumbnailId", "completionMode"];

export function achievementCompletionMode(entry) {
  if (entry?.completionMode === "solo" || entry?.completionMode === "grouped") return entry.completionMode;
  // Preserve the meaning of existing explicitly labelled titles until an admin edits them.
  return entry?.name?.match(/\((solo|grouped)\)\s*$/i)?.[1].toLowerCase() ?? "";
}

export const achievementThumbnailUrl = id => `/api/list/thumbnails/${encodeURIComponent(id)}/image`;

export function formatVerificationDate(value) {
  if (!value) return "Not recorded";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Diff stable IDs, not array indexes, so moving entries is never mistaken for renaming them.
export function achievementChanges(before, after) {
  const oldEntries = new Map(before.map((entry, index) => [entry.id, { entry, position: index + 1 }]));
  const newEntries = new Map(after.map((entry, index) => [entry.id, { entry, position: index + 1 }]));
  const changes = [];
  for (const id of new Set([...newEntries.keys(), ...oldEntries.keys()])) {
    const previous = oldEntries.get(id);
    const next = newEntries.get(id);
    const value = (item, field) => item ? field === "completionMode" ? achievementCompletionMode(item.entry) || undefined : item.entry[field] : undefined;
    const fields = ACHIEVEMENT_FIELDS.filter(field => previous && next
      ? (value(previous, field) ?? "") !== (value(next, field) ?? "")
      : value(previous, field) !== value(next, field))
      .map(field => ({ field, before: value(previous, field) ?? null, after: value(next, field) ?? null }));
    if (!fields.length && previous?.position === next?.position) continue;
    changes.push({ id, name: (next ?? previous).entry.name, completionMode: achievementCompletionMode((next ?? previous).entry), kind: !previous ? "added" : !next ? "removed" : "updated", fromPosition: previous?.position ?? null, toPosition: next?.position ?? null, fields });
  }
  return changes;
}

// Accept only individual YouTube videos; never use user-supplied thumbnail hosts.
export function youtubeVideoId(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let id;
    if (host === "youtu.be") id = url.pathname.match(/^\/([\w-]{11})\/?$/)?.[1];
    else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
      id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/)?.[1];
    }
    return /^[\w-]{11}$/.test(id ?? "") ? id : null;
  } catch { return null; }
}

export function validateListEntries(input) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!Array.isArray(input) || input.length > LIST_LIMIT) fail(`The list can contain up to ${LIST_LIMIT} achievements.`);
  const ids = new Set();
  const names = new Set();
  const text = (value, label, max, required = true) => {
    if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) fail(`${label} must be ${required ? "1" : "0"}–${max} characters.`);
    return value.trim();
  };
  return input.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`Invalid achievement at position ${index + 1}.`);
    if (typeof entry.id !== "string" || !/^[\w-]{1,64}$/.test(entry.id) || ids.has(entry.id)) fail("Each achievement must have a unique valid ID.");
    ids.add(entry.id);
    const name = text(entry.name, "Achievement name", 120);
    if (entry.completionMode !== undefined && !["", "solo", "grouped"].includes(entry.completionMode)) fail("Completion mode must be Solo or Grouped.");
    const completionMode = achievementCompletionMode(entry);
    const nameKey = JSON.stringify([name.toLowerCase(), completionMode]);
    if (names.has(nameKey)) fail(`Duplicate achievement name for this completion mode: ${name}.`);
    names.add(nameKey);
    const difficulty = difficultyRating(entry.difficulty);
    if (!difficulty) fail(`Difficulty for ${name} must be a valid number of 0.0 or higher.`);
    const verifier = text(entry.verifier, "Verifier", 80);
    const verifiedOn = text(entry.verifiedOn ?? "", "Verification date", 10, false);
    if (verifiedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedOn) || verifiedOn.startsWith("0000") || !Number.isFinite(Date.parse(`${verifiedOn}T00:00:00Z`)) || new Date(`${verifiedOn}T00:00:00Z`).toISOString().slice(0, 10) !== verifiedOn)) fail(`Use a valid verification date for ${name}.`);
    const verifiedVersion = text(entry.verifiedVersion ?? "", "Verified game version", 40, false);
    const thumbnailId = text(entry.thumbnailId ?? "", "Thumbnail ID", 64, false);
    if (thumbnailId && !/^[\w-]+$/.test(thumbnailId)) fail("Invalid thumbnail ID.");
    const requirements = text(entry.requirements ?? "", "Completion requirements", 2000, false);
    const video = text(entry.videoUrl ?? "", "YouTube URL", 500, false);
    const videoId = youtubeVideoId(video);
    if (video && !videoId) fail(`Use a valid YouTube video link for ${name}.`);
    return { id: entry.id, name, completionMode, difficulty: difficulty.rating, verifier, verifiedOn, verifiedVersion, thumbnailId, requirements, videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "" };
  });
}
