export const MAX_IMAGES_PER_ENTRY = 20;
export const MAX_IMAGES_PER_UPDATE = 500;
export const NEWS_CONTENT_TYPES = Object.freeze(["game_update", "developer_blog"]);
const NEWS_CONTENT_TYPE_SET = new Set(NEWS_CONTENT_TYPES);
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

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
  "span",
]);
const TAG_ALIASES = new Map([
  ["b", "strong"],
  ["i", "em"],
  ["div", "p"],
  ["font", "span"],
]);
const VOID_TAGS = new Set(["br"]);

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function dateOnlyFromValue(value) {
  if (!value) return null;
  if (typeof value === "string" && DATE_ONLY_PATTERN.test(value)) return value;
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function normalizePublishedOn(value, field = "publishedOn") {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw validationError(`${field} must be a date in YYYY-MM-DD format.`);
  const match = value.match(DATE_ONLY_PATTERN);
  if (!match) throw validationError(`${field} must be a date in YYYY-MM-DD format.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw validationError(`${field} must be a real calendar date.`);
  }
  return value;
}

export function normalizeNewsContentType(value) {
  if (!NEWS_CONTENT_TYPE_SET.has(value)) {
    throw validationError("contentType must be game_update or developer_blog.");
  }
  return value;
}

export function normalizeMinorFlag(value, contentType) {
  if (typeof value !== "boolean") throw validationError("isMinor must be true or false.");
  return contentType === "game_update" && value;
}

export function assertPublishableNewsContent({ contentType, version, blogHtml, itemCount }) {
  if (contentType === "developer_blog") {
    if (updateRichTextPlainLength(blogHtml) < 1) {
      throw validationError("A published developer blog needs content.");
    }
    return;
  }
  if (!version) throw validationError("A published update needs a version.");
  if (!Number.isInteger(itemCount) || itemCount < 1) {
    throw validationError("A published update needs at least one entry.");
  }
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

function safeTextColor(rawColor) {
  if (!rawColor) return null;
  const color = decodeHtmlEntities(rawColor).trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(color) || /^#[0-9a-f]{6}$/.test(color)) return color;

  const rgbMatch = color.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
  if (!rgbMatch) return null;
  const channels = rgbMatch.slice(1).map(Number);
  if (channels.some((channel) => channel < 0 || channel > 255)) return null;
  return `rgb(${channels.join(", ")})`;
}

function colorFromAttributes(originalTag, rawAttributes) {
  if (originalTag === "font") {
    const colorMatch = rawAttributes.match(/\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return safeTextColor(colorMatch?.[1] ?? colorMatch?.[2] ?? colorMatch?.[3] ?? "");
  }

  const styleMatch = rawAttributes.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const style = styleMatch?.[1] ?? styleMatch?.[2] ?? "";
  const declaration = style.split(";").find((part) => part.trim().toLowerCase().startsWith("color:"));
  return safeTextColor(declaration?.slice(declaration.indexOf(":") + 1) ?? "");
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

    if (tag === "span") {
      const color = colorFromAttributes(originalTag, match[3]);
      output.push(color ? `<span style="color:${escapeHtml(color)}">` : "<span>");
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
