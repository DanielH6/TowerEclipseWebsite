export const MAX_IMAGES_PER_ENTRY = 20;

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "u",
  "ul",
  "ol",
  "li",
  "h3",
  "h4",
  "blockquote",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]);
const TAG_ALIASES = new Map([
  ["b", "strong"],
  ["i", "em"],
  ["div", "p"],
]);
const VOID_TAGS = new Set(["br"]);

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, "\u00a0")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(rawHref) {
  if (!rawHref) return null;
  const decoded = decodeHtmlEntities(rawHref.trim());
  try {
    const url = new URL(decoded, "https://towereclipse.invalid");
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
    if (url.origin === "https://towereclipse.invalid") return null;
    return decoded;
  } catch {
    return null;
  }
}

export function sanitizeUpdateRichText(value, field, { max = 50000 } = {}) {
  if (typeof value !== "string") {
    throw validationError(`${field} must be rich-text HTML.`);
  }
  if (value.length > max) {
    throw validationError(`${field} is too long.`);
  }

  const withoutDangerousBlocks = value.replace(
    /<(script|style|iframe|object|embed|svg|math)[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  const tokens = withoutDangerousBlocks.match(/<[^>]*>|[^<]+/g) ?? [];
  const output = [];

  for (const token of tokens) {
    if (!token.startsWith("<")) {
      output.push(escapeHtml(decodeHtmlEntities(token)));
      continue;
    }

    const match = token.match(/^<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/);
    if (!match) continue;
    const closing = match[1] === "/";
    const originalTag = match[2].toLowerCase();
    const tag = TAG_ALIASES.get(originalTag) ?? originalTag;
    if (!ALLOWED_TAGS.has(tag)) continue;

    if (closing) {
      if (!VOID_TAGS.has(tag)) output.push(`</${tag}>`);
      continue;
    }

    if (tag === "a") {
      const hrefMatch = match[3].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = safeHref(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "");
      if (href) {
        output.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">`);
      } else {
        output.push("<a>");
      }
      continue;
    }

    output.push(`<${tag}>`);
  }

  return output.join("").trim();
}

export function updateRichTextPlainLength(html) {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim().length;
}

export function normalizeEntryImages(rawItem, fieldPrefix, title) {
  const rawImages = Array.isArray(rawItem.images)
    ? rawItem.images
    : (rawItem.imageId ? [{ imageId: rawItem.imageId, caption: rawItem.caption ?? "" }] : []);
  if (rawImages.length > MAX_IMAGES_PER_ENTRY) {
    throw validationError(`${title} can contain at most ${MAX_IMAGES_PER_ENTRY} images.`);
  }

  const seenImageIds = new Set();
  return rawImages.map((rawImage, imageIndex) => {
    if (!rawImage || typeof rawImage !== "object") {
      throw validationError(`${fieldPrefix}.images.${imageIndex} must be an object.`);
    }
    if (typeof rawImage.imageId !== "string" || !ID_PATTERN.test(rawImage.imageId)) {
      throw validationError(`${fieldPrefix}.images.${imageIndex}.imageId must be a valid identifier.`);
    }
    if (seenImageIds.has(rawImage.imageId)) {
      throw validationError(`${title} references the same image more than once.`);
    }
    seenImageIds.add(rawImage.imageId);
    const rawCaption = rawImage.caption ?? "";
    if (typeof rawCaption !== "string") {
      throw validationError(`${fieldPrefix}.images.${imageIndex}.caption must be a string.`);
    }
    const caption = rawCaption.trim();
    if (caption.length > 300) {
      throw validationError(`${fieldPrefix}.images.${imageIndex}.caption must contain between 0 and 300 characters.`);
    }
    return { imageId: rawImage.imageId, caption };
  });
}

export function storedEntryImages(item) {
  return Array.isArray(item.images)
    ? item.images
    : (item.imageId ? [{ imageId: item.imageId, caption: item.caption ?? "" }] : []);
}
