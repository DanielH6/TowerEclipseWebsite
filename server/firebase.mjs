import { createSign, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

if (!projectId) {
  throw new Error("Missing required environment variable: FIREBASE_PROJECT_ID");
}

if (!credentialsPath) {
  throw new Error("Missing required environment variable: GOOGLE_APPLICATION_CREDENTIALS");
}

let credentials;
try {
  credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
} catch (error) {
  throw new Error(`Could not read Firebase service-account credentials: ${error.message}`);
}

if (!credentials.client_email || !credentials.private_key) {
  throw new Error("Firebase service-account credentials are missing client_email or private_key.");
}

const databaseName = `projects/${projectId}/databases/(default)`;
const documentsBase = `https://firestore.googleapis.com/v1/${databaseName}/documents`;
const tokenUri = credentials.token_uri || "https://oauth2.googleapis.com/token";
let cachedToken = null;
let tokenExpiresAt = 0;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function accessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) return cachedToken;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(credentials.private_key).toString("base64url");

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${unsigned}.${signature}`,
  });

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Could not obtain Google access token (${response.status}): ${details}`);
  }

  const result = await response.json();
  cachedToken = result.access_token;
  tokenExpiresAt = Date.now() + Number(result.expires_in ?? 3600) * 1000;
  return cachedToken;
}

class FirestoreRestError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "FirestoreRestError";
    this.status = status;
    this.code = code;
  }
}

async function apiRequest(url, { method = "GET", body, allowNotFound = false } = {}) {
  const token = await accessToken();
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const message = parsed?.error?.message || text || `Firestore request failed with ${response.status}.`;
    const code = parsed?.error?.status || null;
    throw new FirestoreRestError(message, response.status, code);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function fullDocumentName(path) {
  return `${databaseName}/documents/${path}`;
}

function documentUrl(path) {
  return `${documentsBase}/${encodePath(path)}`;
}

export class Timestamp {
  constructor(date) {
    this.date = date instanceof Date ? date : new Date(date);
  }

  toDate() {
    return new Date(this.date.getTime());
  }
}

const FIELD_VALUE = Symbol("field-value");

export class FieldValue {
  static serverTimestamp() {
    return { [FIELD_VALUE]: "serverTimestamp" };
  }

  static increment(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError("FieldValue.increment requires a finite number.");
    }
    return { [FIELD_VALUE]: "increment", value };
  }
}

function isFieldValue(value) {
  return Boolean(value && typeof value === "object" && value[FIELD_VALUE]);
}

function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (value instanceof Timestamp) return { timestampValue: value.toDate().toISOString() };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (value && typeof value === "object") {
    return { mapValue: { fields: encodeFields(value) } };
  }
  throw new TypeError(`Unsupported Firestore value: ${String(value)}`);
}

function encodeFields(object) {
  const fields = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || isFieldValue(value)) continue;
    fields[key] = encodeValue(value);
  }
  return fields;
}

function decodeValue(value) {
  if (!value) return undefined;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return new Timestamp(value.timestampValue);
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields ?? {});
  if ("referenceValue" in value) return value.referenceValue;
  if ("bytesValue" in value) return Buffer.from(value.bytesValue, "base64");
  return undefined;
}

function decodeFields(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields ?? {})) result[key] = decodeValue(value);
  return result;
}

function extractWriteData(data, prefix = "") {
  const cleaned = {};
  const transforms = [];

  for (const [key, value] of Object.entries(data ?? {})) {
    if (value === undefined) continue;
    const fieldPath = prefix ? `${prefix}.${key}` : key;

    if (isFieldValue(value)) {
      if (value[FIELD_VALUE] === "serverTimestamp") {
        transforms.push({ fieldPath, setToServerValue: "REQUEST_TIME" });
      } else if (value[FIELD_VALUE] === "increment") {
        transforms.push({ fieldPath, increment: encodeValue(value.value) });
      }
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Timestamp)) {
      const nested = extractWriteData(value, fieldPath);
      cleaned[key] = nested.cleaned;
      transforms.push(...nested.transforms);
    } else {
      cleaned[key] = value;
    }
  }

  return { cleaned, transforms };
}

function topLevelFieldPaths(data) {
  return Object.keys(data ?? {});
}

function buildWrite(kind, reference, data, options = {}) {
  if (kind === "delete") return { delete: fullDocumentName(reference.path) };

  const { cleaned, transforms } = extractWriteData(data);
  const normalFields = topLevelFieldPaths(cleaned);
  const update = {
    name: fullDocumentName(reference.path),
    fields: encodeFields(cleaned),
  };

  if (normalFields.length === 0 && transforms.length > 0 && kind === "update") {
    return {
      transform: {
        document: fullDocumentName(reference.path),
        fieldTransforms: transforms,
      },
      currentDocument: { exists: true },
    };
  }

  const write = { update };
  if (kind === "update" || options.merge === true) {
    write.updateMask = { fieldPaths: normalFields };
  }
  if (kind === "update") write.currentDocument = { exists: true };
  if (transforms.length > 0) write.updateTransforms = transforms;
  return write;
}

class DocumentSnapshot {
  constructor(reference, document = null) {
    this.ref = reference;
    this.id = reference.id;
    this.exists = Boolean(document);
    this._data = document ? decodeFields(document.fields ?? {}) : undefined;
    this.createTime = document?.createTime ? new Timestamp(document.createTime) : undefined;
    this.updateTime = document?.updateTime ? new Timestamp(document.updateTime) : undefined;
  }

  data() {
    return this._data;
  }
}

class QuerySnapshot {
  constructor(documents) {
    this.docs = documents;
    this.empty = documents.length === 0;
    this.size = documents.length;
  }
}

class DocumentReference {
  constructor(path) {
    this.path = path.replace(/^\/+|\/+$/g, "");
    const segments = this.path.split("/");
    this.id = segments.at(-1);
  }

  collection(name) {
    return new CollectionReference(`${this.path}/${name}`);
  }

  async get() {
    const document = await apiRequest(documentUrl(this.path), { allowNotFound: true });
    return new DocumentSnapshot(this, document);
  }

  async set(data, options = {}) {
    await commitWrites([buildWrite("set", this, data, options)]);
  }

  async update(data) {
    await commitWrites([buildWrite("update", this, data)]);
  }

  async delete() {
    await commitWrites([buildWrite("delete", this)]);
  }
}

class Query {
  constructor(path, filters = [], ordering = [], maximum = null) {
    this.path = path;
    this.filters = filters;
    this.ordering = ordering;
    this.maximum = maximum;
  }

  where(fieldPath, operator, value) {
    if (operator !== "==") throw new Error(`Unsupported Firestore query operator: ${operator}`);
    return new Query(this.path, [...this.filters, { fieldPath, value }], this.ordering, this.maximum);
  }

  orderBy(fieldPath, direction = "asc") {
    return new Query(this.path, this.filters, [...this.ordering, { fieldPath, direction }], this.maximum);
  }

  limit(maximum) {
    return new Query(this.path, this.filters, this.ordering, maximum);
  }

  async get() {
    const segments = this.path.split("/");
    const collectionId = segments.at(-1);
    const parentPath = segments.slice(0, -1).join("/");
    const url = parentPath
      ? `${documentsBase}/${encodePath(parentPath)}:runQuery`
      : `${documentsBase}:runQuery`;

    let where;
    if (this.filters.length === 1) {
      const filter = this.filters[0];
      where = {
        fieldFilter: {
          field: { fieldPath: filter.fieldPath },
          op: "EQUAL",
          value: encodeValue(filter.value),
        },
      };
    } else if (this.filters.length > 1) {
      where = {
        compositeFilter: {
          op: "AND",
          filters: this.filters.map((filter) => ({
            fieldFilter: {
              field: { fieldPath: filter.fieldPath },
              op: "EQUAL",
              value: encodeValue(filter.value),
            },
          })),
        },
      };
    }

    const body = {
      structuredQuery: {
        from: [{ collectionId }],
        ...(where ? { where } : {}),
        ...(this.ordering.length > 0
          ? {
              orderBy: this.ordering.map((order) => ({
                field: { fieldPath: order.fieldPath },
                direction: order.direction.toLowerCase() === "desc" ? "DESCENDING" : "ASCENDING",
              })),
            }
          : {}),
        ...(this.maximum ? { limit: this.maximum } : {}),
      },
    };

    const result = await apiRequest(url, { method: "POST", body });
    const documents = (result ?? [])
      .filter((item) => item.document)
      .map((item) => {
        const path = item.document.name.split("/documents/")[1];
        return new DocumentSnapshot(new DocumentReference(path), item.document);
      });
    return new QuerySnapshot(documents);
  }
}

class CollectionReference extends Query {
  constructor(path) {
    super(path);
    this.path = path.replace(/^\/+|\/+$/g, "");
    this.id = this.path.split("/").at(-1);
  }

  doc(id = randomBytes(15).toString("base64url").slice(0, 20)) {
    return new DocumentReference(`${this.path}/${id}`);
  }
}

class WriteBatch {
  constructor() {
    this.writes = [];
  }

  set(reference, data, options = {}) {
    this.writes.push(buildWrite("set", reference, data, options));
    return this;
  }

  update(reference, data) {
    this.writes.push(buildWrite("update", reference, data));
    return this;
  }

  delete(reference) {
    this.writes.push(buildWrite("delete", reference));
    return this;
  }

  async commit() {
    if (this.writes.length === 0) return [];
    const result = await commitWrites(this.writes);
    this.writes = [];
    return result;
  }
}

async function commitWrites(writes, transaction = undefined) {
  const result = await apiRequest(`https://firestore.googleapis.com/v1/${databaseName}/documents:commit`, {
    method: "POST",
    body: { writes, ...(transaction ? { transaction } : {}) },
  });
  return result?.writeResults ?? [];
}

async function beginTransaction() {
  const result = await apiRequest(`https://firestore.googleapis.com/v1/${databaseName}/documents:beginTransaction`, {
    method: "POST",
    body: {},
  });
  return result.transaction;
}

class Transaction extends WriteBatch {
  constructor(id) {
    super();
    this.id = id;
  }

  async get(reference) {
    const url = new URL(documentUrl(reference.path));
    url.searchParams.set("transaction", this.id);
    const document = await apiRequest(url.toString(), { allowNotFound: true });
    return new DocumentSnapshot(reference, document);
  }

  async commit() {
    return commitWrites(this.writes, this.id);
  }
}

async function rollbackTransaction(transaction) {
  try {
    await apiRequest(`https://firestore.googleapis.com/v1/${databaseName}/documents:rollback`, {
      method: "POST",
      body: { transaction },
    });
  } catch {
  }
}

async function recursiveDelete(reference) {
  const subcollections = ["comments", "activity", "developerNotes"];
  const references = [];

  for (const subcollection of subcollections) {
    const snapshot = await reference.collection(subcollection).limit(1000).get();
    references.push(...snapshot.docs.map((document) => document.ref));
  }
  references.push(reference);

  for (let index = 0; index < references.length; index += 450) {
    const batch = new WriteBatch();
    references.slice(index, index + 450).forEach((item) => batch.delete(item));
    await batch.commit();
  }
}

export const db = {
  doc(path) {
    return new DocumentReference(path);
  },

  collection(path) {
    return new CollectionReference(path);
  },

  batch() {
    return new WriteBatch();
  },

  async getAll(...references) {
    return Promise.all(references.map((reference) => reference.get()));
  },

  async runTransaction(callback) {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = await beginTransaction();
      const transaction = new Transaction(id);
      try {
        const result = await callback(transaction);
        await transaction.commit();
        return result;
      } catch (error) {
        lastError = error;
        await rollbackTransaction(id);
        const retryable = error?.status === 409 || error?.code === "ABORTED";
        if (!retryable || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      }
    }
    throw lastError;
  },

  recursiveDelete,
};
