import { GAME_DATA_LIMITS } from "./game-data-config.mjs";
import { gameDataError } from "./game-data-domain.mjs";

// Shared GET-only executor for exact reads and the controlled metadata check.
// No environment reads, default fetch, credential loading or logging.
const ORIGIN = "https://apis.roblox.com/cloud/v2/";
const fail = code => gameDataError(503, code, "The saved-data source is unavailable.");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const segment = value => typeof value === "string" && value.length > 0 && value.length <= 128
  && value.isWellFormed() && value.trim() === value && value !== "." && value !== ".." && !/[\u0000-\u001f\u007f/\\?#%@]/.test(value);

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(fail("READ_ABORTED"));
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(fail("READ_ABORTED")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

function sleep(ms, signal) {
  if (signal.aborted) return Promise.reject(fail("READ_ABORTED"));
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(fail("READ_ABORTED")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function discard(response) {
  // Never parse/log upstream error bodies or wait on a broken cancel method.
  try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch {}
}

async function boundedJson(response, signal, maxBytes) {
  const type = response.headers?.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const length = response.headers?.get("content-length");
  if (type !== "application/json" || (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes))) {
    await discard(response); throw fail("INVALID_PROFILE");
  }
  if (typeof response.body?.getReader !== "function") throw fail("INVALID_PROFILE");
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0, completed = false;
  try {
    while (true) {
      const result = await abortable(reader.read(), signal);
      if (result.done) { completed = true; break; }
      if (!(result.value instanceof Uint8Array) || (bytes += result.value.byteLength) > maxBytes) throw fail("INVALID_PROFILE");
      chunks.push(Buffer.from(result.value));
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
    return JSON.parse(raw);
  } catch (error) {
    if (signal.aborted) throw fail("READ_ABORTED");
    throw fail("INVALID_PROFILE");
  } finally {
    if (!completed) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} }
    try { reader.releaseLock(); } catch {}
  }
}

function retryAfterMs(response, now) {
  const value = response.headers?.get("retry-after");
  if (typeof value !== "string" || value.length > 128) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export function createRobloxReadHttp({ fetch: request, config, now = Date.now, wait = sleep, random = Math.random }) {
  if (typeof request !== "function" || !object(config) || typeof config.universeId !== "string" || !/^[1-9]\d{0,15}$/.test(config.universeId)
    || typeof config.apiKey !== "string" || !config.apiKey.length || config.apiKey.length > 8192 || /[\r\n]/.test(config.apiKey)) {
    throw fail("READER_NOT_CONFIGURED");
  }
  const timeoutMs = config.timeoutMs ?? 10000, requestsPerMinute = config.requestsPerMinute ?? 60;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000
    || !Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 300
    || typeof now !== "function" || typeof wait !== "function" || typeof random !== "function") throw fail("READER_NOT_CONFIGURED");
  const universeId = config.universeId, apiKey = config.apiKey;
  const inflight = new Set();
  let activeReads = 0, nextStartAt = 0, cooldownUntil = 0;

  async function get(resourceParts, { signal: callerSignal, query = {}, maxBytes = GAME_DATA_LIMITS.maxProfileBytes + 65536 } = {}) {
    if (!Array.isArray(resourceParts) || !resourceParts.length || !resourceParts.every(segment)
      || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > GAME_DATA_LIMITS.maxProfileBytes + 65536) throw fail("INVALID_PROFILE");
    if (callerSignal !== undefined && !(callerSignal instanceof AbortSignal)) throw fail("READ_UNAVAILABLE");
    if (callerSignal?.aborted) throw fail("READ_ABORTED");
    if (activeReads >= GAME_DATA_LIMITS.maxConcurrentReads || inflight.size >= GAME_DATA_LIMITS.maxConcurrentReads) throw fail("READ_LIMIT");
    activeReads++;
    const controller = new AbortController(), signal = controller.signal, deadline = now() + timeoutMs;
    const abort = () => controller.abort();
    callerSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    const parts = ["universes", universeId, ...resourceParts];
    const url = new URL(ORIGIN + parts.map(encodeURIComponent).join("/"));
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    async function pause(delay) {
      if (!Number.isFinite(delay) || now() + delay >= deadline) throw fail("READ_RATE_LIMITED");
      await abortable(wait(delay, signal), signal);
    }
    async function pace() {
      while (Math.max(nextStartAt, cooldownUntil) > now()) await pause(Math.max(nextStartAt, cooldownUntil) - now());
      if (signal.aborted || now() >= deadline) throw fail("READ_ABORTED");
      nextStartAt = now() + 60000 / requestsPerMinute;
    }
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await pace();
        if (inflight.size >= GAME_DATA_LIMITS.maxConcurrentReads) throw fail("READ_LIMIT");
        const pending = Promise.resolve().then(() => request(url.href, {
          method: "GET", headers: { "x-api-key": apiKey, Accept: "application/json" },
          signal, redirect: "error", credentials: "omit", cache: "no-store",
        }));
        inflight.add(pending);
        pending.then(response => { inflight.delete(pending); if (signal.aborted) void discard(response); }, () => inflight.delete(pending));
        let response;
        try { response = await abortable(pending, signal); }
        catch {
          if (signal.aborted) throw fail("READ_ABORTED");
          if (attempt === 2) throw fail("READ_UNAVAILABLE");
          await pause(250 * 2 ** attempt + Math.floor(random() * 100)); continue;
        }
        // Await the body so deadline/cancellation and the slot cover streaming.
        if (response.status === 200) return await boundedJson(response, signal, maxBytes);
        const status = response.status;
        const retryable = [429, 500, 502, 503, 504].includes(status);
        const delay = Math.max(250 * 2 ** attempt + Math.floor(random() * 100), retryAfterMs(response, now()));
        await discard(response);
        if (status === 429) cooldownUntil = Math.max(cooldownUntil, now() + delay);
        if (!retryable || attempt === 2) throw fail(status === 429 ? "READ_RATE_LIMITED" : status === 401 || status === 403 ? "READ_ACCESS_DENIED" : "READ_UNAVAILABLE");
        await pause(delay);
      }
    } catch (error) {
      if (signal.aborted) throw fail("READ_ABORTED");
      if (["READ_ABORTED", "READ_RATE_LIMITED", "READ_ACCESS_DENIED", "READ_UNAVAILABLE", "READ_LIMIT", "INVALID_PROFILE"].includes(error?.code)) throw error;
      throw fail("READ_UNAVAILABLE");
    } finally { activeReads--; clearTimeout(timer); callerSignal?.removeEventListener("abort", abort); }
  }
  return Object.freeze({ get });
}
