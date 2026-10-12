import { GAME_DATA_LIMITS } from "./game-data-config.mjs";
import { gameDataError, validatePlayerId } from "./game-data-domain.mjs";
import { createRobloxReadHttp } from "./roblox-read-http.mjs";

const fail = code => gameDataError(503, code, "The saved-data source is unavailable.");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const segment = value => typeof value === "string" && value.length > 0 && value.length <= 128
  && value.isWellFormed() && value.trim() === value && value !== "." && value !== ".." && !/[\u0000-\u001f\u007f/\\?#%@]/.test(value);
const timestamp = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  && value.length <= 64 && Number.isFinite(Date.parse(value));

function checkStructure(root) {
  const stack = [[root, 0]]; let scheduled = 1;
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (depth > GAME_DATA_LIMITS.maxDepth) throw fail("INVALID_PROFILE");
    if (value && typeof value === "object") {
      const keys = Array.isArray(value) ? null : Object.keys(value);
      // Reject broad structures before allocating one work item per child.
      scheduled += keys ? keys.length : value.length;
      if (scheduled > GAME_DATA_LIMITS.maxNodes) throw fail("INVALID_PROFILE");
      if (keys) { for (const key of keys) stack.push([value[key], depth + 1]); }
      else { for (const item of value) stack.push([item, depth + 1]); }
    }
  }
}

function decodeResponse(body, universeId, store, userId) {
  if (!object(body)) throw fail("INVALID_PROFILE");
  const parent = `universes/${universeId}/data-stores/${store.dataStoreId}`;
  const paths = [`${parent}/scopes/${store.scopeId}/entries/${userId}`, `${parent}/entries/${store.scopeId}/${userId}`];
  if (store.scopeId === "global") paths.push(`${parent}/entries/${userId}`);
  if (body.path !== undefined) {
    if (typeof body.path !== "string" || body.path.length > 1024) throw fail("INVALID_PROFILE");
    let path;
    try { path = body.path.split("/").map(decodeURIComponent).join("/"); } catch { throw fail("INVALID_PROFILE"); }
    if (!paths.includes(path)) throw fail("INVALID_PROFILE");
  }
  if (body.id !== undefined && body.id !== userId && body.id !== `${store.scopeId}/${userId}`) throw fail("INVALID_PROFILE");
  // Omitted identity metadata relies on the validated scoped GET request.
  // Present identities must agree; no metadata is inferred from profile Data.
  // Do not mistake an inaccessible/wrong datastore's 404 for an absent player.
  // Only an explicitly DELETED resource with a matching identity is confirmed.
  if (body.state === "DELETED") return null;
  if (![undefined, "STATE_UNSPECIFIED", "ACTIVE"].includes(body.state) || !object(body.value) || !object(body.value.Data)) throw fail("INVALID_PROFILE");
  const revision = body.revisionId === undefined || body.revisionId === "" ? null : body.revisionId;
  const updatedAt = body.revisionCreateTime === undefined || body.revisionCreateTime === "" ? null : body.revisionCreateTime;
  if ((revision !== null && (typeof revision !== "string" || revision.length > 256 || /[\u0000-\u001f\u007f]/.test(revision)))
    || (updatedAt !== null && !timestamp(updatedAt))) throw fail("INVALID_PROFILE");
  checkStructure(body.value);
  if (Buffer.byteLength(JSON.stringify(body.value)) > GAME_DATA_LIMITS.maxProfileBytes) throw fail("INVALID_PROFILE");
  // No users/attributes/etag/createTime/session metadata is mapped to freshness.
  return { envelope: body.value, revision, updatedAt: updatedAt === null ? null : new Date(updatedAt).toISOString() };
}

export function createRobloxProfileReader(options = {}) {
  const { config } = options;
  if (!["main", "battlefront"].every(mode => segment(config?.stores?.[mode]?.dataStoreId) && segment(config?.stores?.[mode]?.scopeId))) throw fail("READER_NOT_CONFIGURED");
  const http = options.http ?? createRobloxReadHttp(options);
  const universeId = config.universeId;
  const stores = Object.fromEntries(["main", "battlefront"].map(mode => [mode, { ...config.stores[mode] }]));
  async function read(mode, userId, options = {}) {
    validatePlayerId(userId);
    if (!Object.hasOwn(stores, mode)) throw fail("INVALID_MODE");
    const store = stores[mode];
    const body = await http.get(["data-stores", store.dataStoreId, "scopes", store.scopeId, "entries", userId], { signal: options.signal });
    return decodeResponse(body, universeId, store, userId);
  }
  return Object.freeze({ read });
}
