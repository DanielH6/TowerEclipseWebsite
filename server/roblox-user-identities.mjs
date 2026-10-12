import { gameDataError, validatePlayerId } from "./game-data-domain.mjs";
import { boundedOperation } from "./player-summary-import.mjs";

const fail = () => gameDataError(503, "IDENTITIES_UNAVAILABLE", "Roblox names are temporarily unavailable.");
const name = value => typeof value === "string" && value.length > 0 && value.length <= 64
  && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);

export function createRobloxUserIdentities({ fetch: request, now = Date.now }) {
  if (typeof request !== "function") throw fail();
  let cooldownUntil = 0, active = false;
  return { async resolve(ids, { signal } = {}) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 10 || new Set(ids).size !== ids.length) throw fail();
    ids.forEach(validatePlayerId);
    if (active || now() < cooldownUntil) throw fail();
    signal?.throwIfAborted(); active = true;
    let started = false;
    try {
      return await boundedOperation(async requestSignal => {
        started = true;
        try {
        // The documented POST is a public lookup; no cookie/key/OAuth is sent.
        const response = await request("https://users.roblox.com/v1/users", { method: "POST", redirect: "error", credentials: "omit",
          headers: { "content-type": "application/json", Accept: "application/json" }, signal: requestSignal,
          body: JSON.stringify({ userIds: ids.map(Number), excludeBannedUsers: false }) });
        if (!response.ok) {
          if (response.status === 429) {
            const raw = response.headers.get("retry-after"), seconds = Number(raw);
            cooldownUntil = now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 300000) : 60000);
          }
          try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch {}
          throw fail();
        }
        if (!response.headers.get("content-type")?.startsWith("application/json")) throw fail();
        const reader = response.body.getReader(), chunks = []; let bytes = 0;
        try {
          while (true) { requestSignal.throwIfAborted(); const item = await reader.read(); if (item.done) break;
            if ((bytes += item.value.byteLength) > 32768) throw fail(); chunks.push(Buffer.from(item.value)); }
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!Array.isArray(body.data) || body.data.length > ids.length) throw fail();
          const result = {};
          for (const user of body.data) {
            if (!Number.isSafeInteger(user.id) || !ids.includes(String(user.id)) || result[user.id] || !name(user.name) || !name(user.displayName)) throw fail();
            result[user.id] = { username: user.name, displayName: user.displayName, checkedAt: new Date(now()).toISOString() };
          }
          return result;
        } finally { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} }
        } finally { active = false; }
      }, 5000, signal);
    } catch { if (!started) active = false; throw fail(); }
  } };
}
