import crypto from "node:crypto";
import { GAME_DATA_LIMITS, GAME_DATA_SORTS } from "./game-data-config.mjs";
import { decodeSavedProfile, foldIdentity, gameDataError, redactGameData, validatePlayerId } from "./game-data-domain.mjs";

const invalidQuery = message => gameDataError(400, "INVALID_QUERY", message);

export function parsePlayerQuery(input, limits = GAME_DATA_LIMITS) {
  const allowed = new Set(["mode", "search", "searchField", "sort", "order", "minLevel", "limit", "cursor"]);
  if (Object.keys(input).some(key => !allowed.has(key) || typeof input[key] !== "string")) throw invalidQuery("Unsupported or repeated player filter.");
  const mode = input.mode ?? "main";
  const search = foldIdentity((input.search ?? "").trim());
  const searchField = input.searchField ?? "username";
  const sort = input.sort ?? (search ? searchField : "level");
  const order = input.order ?? (search ? "asc" : "desc");
  if (!["main", "battlefront"].includes(mode) || !["username", "displayName"].includes(searchField) || !Object.hasOwn(GAME_DATA_SORTS, sort) || !["asc", "desc"].includes(order)) throw invalidQuery("Unsupported mode or sort.");
  if (mode === "battlefront" && sort === "rankedISR") throw invalidQuery("Ranked ISR belongs to Main mode.");
  if (search.length > 64 || /[\u0000-\u001f\u007f]/.test(search)) throw invalidQuery("Search must contain at most 64 visible characters.");
  if (search && (sort !== searchField || order !== "asc")) throw invalidQuery("Prefix search must sort by the searched name, ascending.");
  const minimum = input.minLevel ?? "";
  if (minimum && (!/^\d{1,7}$/.test(minimum) || search || sort !== "level")) throw invalidQuery("Minimum level requires level sort without a name search.");
  const limit = input.limit ?? String(limits.pageSize);
  if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > limits.maxPageSize) throw invalidQuery(`Page size must be between 1 and ${limits.maxPageSize}.`);
  if ((input.cursor ?? "").length > 4096) throw invalidQuery("Invalid player cursor.");
  return { mode, search, searchField, sort, order, minLevel: minimum ? Number(minimum) : null, limit: Number(limit) };
}

export function createGameDataService({ reader, summaryIndex, cursorSecret, enabled = true, limits = GAME_DATA_LIMITS, now = Date.now }) {
  if (typeof reader?.read !== "function" || typeof summaryIndex?.list !== "function" || typeof cursorSecret !== "string" || cursorSecret.length < 16) throw new Error("A profile reader, summary index and cursor signing key are required.");
  const cache = new Map();
  const pending = new Map();
  const profileReads = new Set();
  const indexReads = new Set();
  let cacheBytes = 0;
  const sign = payload => crypto.createHmac("sha256", cursorSecret).update(payload).digest("base64url");
  function available() {
    if (!enabled) throw gameDataError(503, "VIEWER_DISABLED", "Player data is not connected yet.");
  }
  function readCursor(cursor, query, actorId) {
    if (!cursor) return { snapshotAt: new Date(now() - 1000).toISOString(), after: null, expiresAt: now() + limits.cursorTtlMs };
    try {
      const [payload, signature, extra] = cursor.split(".");
      const expected = Buffer.from(sign(payload)), received = Buffer.from(signature ?? "");
      if (extra || expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) throw new Error();
      const value = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (value.actorId !== actorId || JSON.stringify(value.query) !== JSON.stringify(query) || !Array.isArray(value.after) || value.after.length !== 2) throw new Error();
      if (value.expiresAt <= now()) throw gameDataError(409, "CURSOR_EXPIRED", "This result snapshot expired. Refresh the player list.");
      return value;
    } catch (error) {
      if (error?.code === "CURSOR_EXPIRED") throw error;
      throw invalidQuery("Invalid or mismatched player cursor.");
    }
  }
  async function list(input, actorId) {
    available();
    const query = parsePlayerQuery(input, limits);
    const page = readCursor(input.cursor, query, actorId);
    if (indexReads.size >= limits.maxConcurrentIndexReads) {
      throw gameDataError(503, "INDEX_UNAVAILABLE", "Player search is busy. Try again shortly.");
    }
    const request = Promise.resolve().then(() => summaryIndex.list(query, page));
    indexReads.add(request);
    // A timed-out adapter keeps its slot until it settles. This also bounds an
    // existing transport that cannot yet cancel its underlying request.
    request.then(() => indexReads.delete(request), () => indexReads.delete(request));
    let timer;
    let result;
    try {
      result = await Promise.race([
        request,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(gameDataError(503, "INDEX_UNAVAILABLE", "Player search timed out. Try again later.")), limits.indexReadTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    const items = result.items.slice(0, query.limit);
    let nextCursor = null;
    if (result.items.length > query.limit && items.length) {
      const last = items.at(-1);
      const field = GAME_DATA_SORTS[query.sort].split(".").reduce((value, key) => value?.[key], last);
      const payload = Buffer.from(JSON.stringify({ actorId, query, snapshotAt: page.snapshotAt, expiresAt: page.expiresAt, after: [field, `${query.mode}:${last.userId}`] })).toString("base64url");
      nextCursor = `${payload}.${sign(payload)}`;
    }
    return { items, nextCursor, snapshotAt: page.snapshotAt, coverage: result.coverage, synthetic: reader.synthetic === true };
  }
  function remember(key, value, checkedAt) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (cache.has(key)) { cacheBytes -= cache.get(key).bytes; cache.delete(key); }
    if (bytes > limits.maxCacheBytes) return;
    while (cache.size && (cache.size >= limits.maxCacheEntries || cacheBytes + bytes > limits.maxCacheBytes)) {
      const oldest = cache.keys().next().value;
      cacheBytes -= cache.get(oldest).bytes; cache.delete(oldest);
    }
    cache.set(key, { value, checkedAt, bytes }); cacheBytes += bytes;
  }
  function responseMode(value, checkedAt, stale = false) {
    return { ...value, freshness: { status: value.status === "missing" ? "missing" : stale ? "stale" : "saved_snapshot", sourceUpdatedAt: value.summary?.source.updatedAt ?? null, lastCheckedAt: new Date(checkedAt).toISOString(), servedAt: new Date(now()).toISOString(), cacheAgeSeconds: Math.max(0, Math.floor((now() - checkedAt) / 1000)), reason: stale ? "Refresh failed; showing the last verified saved snapshot." : null } };
  }
  async function readMode(mode, userId) {
    const key = `${mode}:${userId}`, previous = cache.get(key);
    const ttl = previous?.value.status === "missing" ? limits.missingTtlMs : limits.detailTtlMs;
    if (previous && now() - previous.checkedAt < ttl) return responseMode(previous.value, previous.checkedAt);
    if (pending.has(key)) return pending.get(key);
    if (profileReads.size >= limits.maxConcurrentReads) return { status: "unavailable", code: "READ_LIMIT", message: "Saved data is busy. Try again shortly.", summary: null, detail: null, freshness: null };
    const task = (async () => {
      const controller = new AbortController();
      let timer;
      try {
        const request = Promise.resolve().then(() => reader.read(mode, userId, { signal: controller.signal }));
        profileReads.add(request);
        // Keep timed-out transports counted until they settle, even if a future
        // injected transport fails to honour cancellation promptly.
        request.then(() => profileReads.delete(request), () => profileReads.delete(request));
        const entry = await Promise.race([
          request,
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Read timed out")); }, limits.readTimeoutMs); }),
        ]);
        const checkedAt = now();
        const savedEntry = entry === null ? null : { ...entry, checkedAt: new Date(checkedAt).toISOString() };
        const value = savedEntry === null ? { status: "missing", summary: null, detail: null, removedFields: 0 } : { status: "ready", ...decodeSavedProfile(mode, userId, savedEntry, limits) };
        if (savedEntry && reader.synthetic === true) {
          const fixtureDetail = redactGameData(savedEntry.envelope.Data, limits);
          Object.assign(value, { detail: fixtureDetail.data, detailStatus: "synthetic_redacted", removedFields: fixtureDetail.removedFields });
        }
        remember(key, value, checkedAt);
        return responseMode(value, checkedAt);
      } catch (error) {
        if (previous?.value.status === "ready" && now() - previous.checkedAt < limits.staleRetentionMs) return responseMode(previous.value, previous.checkedAt, true);
        return { status: "unavailable", code: error?.code === "INVALID_PROFILE" ? "INVALID_PROFILE" : "READ_UNAVAILABLE", message: "This mode's saved data could not be read. Try again later.", summary: null, detail: null, freshness: null };
      } finally { clearTimeout(timer); }
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  async function profile(userId) {
    available(); validatePlayerId(userId);
    const [main, battlefront] = await Promise.all([readMode("main", userId), readMode("battlefront", userId)]);
    return { userId, main, battlefront, synthetic: reader.synthetic === true };
  }
  return { list, profile };
}
