import { createRobloxReadHttp } from "./roblox-read-http.mjs";
import { createRobloxProfileReader } from "./roblox-profile-reader.mjs";
import { gameDataError, validatePlayerId } from "./game-data-domain.mjs";

const fail = () => gameDataError(503, "LIST_UNAVAILABLE", "Profile traversal is unavailable. Verify the configured stores and Roblox objects:list permission.");
export function createRobloxEntryLister(options) {
  // Reuse the profile reader's strict store configuration check without reads.
  createRobloxProfileReader(options);
  const http = options.http ?? createRobloxReadHttp(options), { config } = options;
  const stores = structuredClone(config.stores), universeId = config.universeId;
  return { async list(mode, { cursor = "", limit = 5, signal } = {}) {
    if (!["main", "battlefront"].includes(mode) || !Number.isInteger(limit) || limit < 1 || limit > 10
      || typeof cursor !== "string" || cursor.length > 4096 || /[\u0000-\u001f\u007f]/.test(cursor)) throw fail();
    const store = stores[mode];
    const body = await http.get(["data-stores", store.dataStoreId, "scopes", store.scopeId, "entries"], {
      signal, query: { maxPageSize: String(limit), ...(cursor ? { pageToken: cursor } : {}) }, maxBytes: 262144,
    });
    if (!body || typeof body !== "object" || Array.isArray(body)) throw fail();
    const entries = body.dataStoreEntries === undefined ? [] : body.dataStoreEntries;
    const nextCursor = body.nextPageToken === undefined ? "" : body.nextPageToken;
    if (!Array.isArray(entries) || entries.length > limit || typeof nextCursor !== "string" || nextCursor.length > 4096
      || /[\u0000-\u001f\u007f]/.test(nextCursor) || (nextCursor && nextCursor === cursor)) throw fail();
    const ids = []; let rejectedKeys = 0;
    for (const item of entries) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || item.id.length > 128) throw fail();
      const key = item.id.startsWith(`${store.scopeId}/`) ? item.id.slice(store.scopeId.length + 1) : item.id;
      const parent = `universes/${universeId}/data-stores/${store.dataStoreId}`;
      const allowed = [`${parent}/scopes/${store.scopeId}/entries/${key}`, `${parent}/entries/${store.scopeId}/${key}`];
      if (store.scopeId === "global") allowed.push(`${parent}/entries/${key}`);
      if (item.path !== undefined) {
        let path; try { path = item.path.split("/").map(decodeURIComponent).join("/"); } catch { throw fail(); }
        if (!allowed.includes(path)) throw fail();
      }
      try { validatePlayerId(key); } catch { rejectedKeys++; continue; }
      if (!ids.includes(key)) ids.push(key);
    }
    return { ids, nextCursor, rejectedKeys, observedKeys: entries.length };
  } };
}
