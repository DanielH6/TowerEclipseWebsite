import {
  createHmac,
  createHash,
} from "node:crypto";
import path from "node:path";
import { config } from "./config.mjs";

const REGION = "auto";
const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

const FILE_TYPES = new Map([
  [".png", ["image/png"]],
  [".jpg", ["image/jpeg"]],
  [".jpeg", ["image/jpeg"]],
]);

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
]);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertEnabled() {
  if (!config.r2) {
    throw httpError(
      503,
      "Image storage is not configured. Add the R2 environment variables and restart the API.",
    );
  }

  return config.r2;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding = undefined) {
  return createHmac("sha256", key).update(value).digest(encoding);
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalObjectPath(bucket, key) {
  return `/${[bucket, ...key.split("/")].map(awsEncode).join("/")}`;
}

function canonicalQuery(parameters) {
  return [...parameters.entries()]
    .map(([key, value]) => [awsEncode(key), awsEncode(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey < rightKey) return -1;
      if (leftKey > rightKey) return 1;
      if (leftValue < rightValue) return -1;
      if (leftValue > rightValue) return 1;
      return 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function amzDates(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function signingKey(secretAccessKey, dateStamp) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, REGION);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, "aws4_request");
}

function normalizedHeaderValue(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

function createPresignedUrl({
  method,
  key,
  expiresIn,
  headers = {},
}) {
  const r2 = assertEnabled();
  const endpoint = new URL(r2.endpointOrigin);
  const host = endpoint.host;
  const canonicalUri = canonicalObjectPath(r2.bucket, key);
  const { amzDate, dateStamp } = amzDates();
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

  const normalizedHeaders = new Map([
    ["host", host],
    ...Object.entries(headers).map(([name, value]) => [
      name.toLowerCase(),
      normalizedHeaderValue(value),
    ]),
  ]);

  const sortedHeaders = [...normalizedHeaders.entries()].sort(([left], [right]) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  const signedHeaders = sortedHeaders.map(([name]) => name).join(";");
  const canonicalHeaders = `${sortedHeaders
    .map(([name, value]) => `${name}:${value}`)
    .join("\n")}\n`;

  const query = new URLSearchParams({
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${r2.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": signedHeaders,
  });
  const queryString = canonicalQuery(query);

  const canonicalRequest = [
    method,
    canonicalUri,
    queryString,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join("\n");
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");
  const signature = hmac(
    signingKey(r2.secretAccessKey, dateStamp),
    stringToSign,
    "hex",
  );

  return `${r2.endpointOrigin}${canonicalUri}?${queryString}&X-Amz-Signature=${signature}`;
}

function cleanOriginalName(value) {
  if (typeof value !== "string") {
    throw httpError(400, "fileName must be a string.");
  }

  const normalizedPath = value.trim().replace(/\\/g, "/");
  const name = path.posix.basename(normalizedPath).replace(/[\u0000-\u001f\u007f]/g, "");
  if (!name || name.length > 180) {
    throw httpError(400, "File names must contain between 1 and 180 characters.");
  }

  return name;
}

function safeObjectName(originalName) {
  const extension = path.extname(originalName).toLowerCase();
  const stem = path.basename(originalName, extension)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "attachment";
  return `${stem}${extension}`;
}

function safeDispositionName(originalName) {
  return safeObjectName(originalName).replace(/["\\]/g, "-");
}

export function normalizeAttachmentInput({ fileName, contentType, size }) {
  const r2 = assertEnabled();
  const originalName = cleanOriginalName(fileName);
  const extension = path.extname(originalName).toLowerCase();
  const allowedTypes = FILE_TYPES.get(extension);

  if (!allowedTypes) {
    throw httpError(
      400,
      "Unsupported attachment type. Use PNG, JPG, or JPEG images only.",
    );
  }

  const suppliedType = typeof contentType === "string"
    ? contentType.trim().toLowerCase().split(";")[0]
    : "";
  const normalizedType = !suppliedType || suppliedType === "application/octet-stream"
    ? allowedTypes[0]
    : suppliedType;

  if (!allowedTypes.includes(normalizedType)) {
    throw httpError(400, `The content type ${normalizedType} does not match ${extension}.`);
  }

  const normalizedSize = Number(size);
  if (!Number.isSafeInteger(normalizedSize) || normalizedSize < 1) {
    throw httpError(400, "Image size must be a positive integer.");
  }
  if (normalizedSize > r2.maxFileSizeBytes) {
    throw httpError(
      413,
      `Images may not exceed ${Math.floor(r2.maxFileSizeBytes / 1024 / 1024)} MB.`,
    );
  }

  return {
    originalName,
    objectName: safeObjectName(originalName),
    contentType: normalizedType,
    size: normalizedSize,
    previewKind: "image",
    contentDisposition: `inline; filename="${safeDispositionName(originalName)}"`,
  };
}

export function attachmentStoragePolicy() {
  const r2 = config.r2;
  return {
    enabled: Boolean(r2),
    maxFileSizeBytes: r2?.maxFileSizeBytes ?? 0,
    maxFilesPerReport: r2?.maxFilesPerReport ?? 0,
    uploadUrlTtlSeconds: r2?.uploadUrlTtlSeconds ?? 0,
    downloadUrlTtlSeconds: r2?.downloadUrlTtlSeconds ?? 0,
    allowedExtensions: [...FILE_TYPES.keys()].map((value) => value.slice(1)),
  };
}

export function createAttachmentUploadUrl(key, contentType) {
  const r2 = assertEnabled();
  const headers = {
    "content-type": contentType,
  };

  return {
    url: createPresignedUrl({
      method: "PUT",
      key,
      expiresIn: r2.uploadUrlTtlSeconds,
      headers,
    }),
    headers: {
      "Content-Type": contentType,
    },
    expiresIn: r2.uploadUrlTtlSeconds,
  };
}

export function createAttachmentDownloadUrl(key) {
  const r2 = assertEnabled();
  return createPresignedUrl({
    method: "GET",
    key,
    expiresIn: r2.downloadUrlTtlSeconds,
  });
}

export async function headAttachmentObject(key) {
  const url = createPresignedUrl({
    method: "HEAD",
    key,
    expiresIn: 120,
  });
  const response = await fetch(url, { method: "HEAD" });

  if (response.status === 404) return null;
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw httpError(
      502,
      `R2 could not verify the uploaded attachment (${response.status}). ${details}`.trim(),
    );
  }

  const size = Number(response.headers.get("content-length"));
  return {
    size: Number.isSafeInteger(size) ? size : null,
    contentType: response.headers.get("content-type")?.toLowerCase().split(";")[0] ?? null,
    contentDisposition: response.headers.get("content-disposition"),
    etag: response.headers.get("etag")?.replace(/^"|"$/g, "") ?? null,
  };
}

export async function deleteAttachmentObject(key, { ignoreMissing = true } = {}) {
  const url = createPresignedUrl({
    method: "DELETE",
    key,
    expiresIn: 120,
  });
  const response = await fetch(url, { method: "DELETE" });

  if (ignoreMissing && response.status === 404) return false;
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw httpError(
      502,
      `R2 could not delete the attachment (${response.status}). ${details}`.trim(),
    );
  }

  return true;
}
