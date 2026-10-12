export const GAME_DATA_LIMITS = Object.freeze({
  pageSize: 25,
  maxPageSize: 100,
  cursorTtlMs: 15 * 60 * 1000,
  detailTtlMs: 60 * 1000,
  missingTtlMs: 30 * 1000,
  staleRetentionMs: 15 * 60 * 1000,
  maxCacheEntries: 100,
  maxCacheBytes: 32 * 1024 * 1024,
  maxProfileBytes: 4 * 1024 * 1024,
  maxDepth: 20,
  maxNodes: 100000,
  readTimeoutMs: 10000,
  maxConcurrentReads: 8,
  maxConcurrentIndexReads: 4,
  indexReadTimeoutMs: 10000,
  requestsPerMinute: 60,
});

export const GAME_DATA_STORES = Object.freeze({
  main: { name: "PlayerData V24", scope: "global" },
  battlefront: { name: "PlayerData V1_battlefront", scope: "global" },
});

export const GAME_DATA_SORTS = Object.freeze({
  level: "stats.level",
  gamesPlayed: "stats.gamesPlayed",
  rankedISR: "stats.rankedISR",
  lastJoinedDate: "lastJoinedDate",
  username: "identity.usernameFolded",
  displayName: "identity.displayNameFolded",
});

export function gameDataEnabled(environment = process.env) {
  const value = environment.TE_DATA_VIEWER_ENABLED;
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw configurationError("TE_DATA_VIEWER_ENABLED");
}

export const PLAYER_DATA_ENV = Object.freeze({
  key: "ROBLOX_DATASTORE_READ_API_KEY",
  universe: "ROBLOX_UNIVERSE_ID",
  main: "ROBLOX_MAIN_DATASTORE_ID",
  battlefront: "ROBLOX_BATTLEFRONT_DATASTORE_ID",
});

function configurationError(variable) {
  // Include only our fixed variable name, never its value or a caught error.
  return Object.assign(new Error(`Invalid or missing player-data configuration: ${variable}.`), {
    code: "INVALID_PLAYER_DATA_CONFIG", variable,
  });
}

function requiredValue(environment, variable) {
  const value = environment[variable];
  if (typeof value !== "string" || !value.length || value.trim() !== value
    || /PASTE_|REPLACE_|YOUR_|[<>]/i.test(value)) throw configurationError(variable);
  return value;
}

export function readRobloxDataStoreConfig(environment = process.env, { includeStores = true } = {}) {
  const universeId = requiredValue(environment, PLAYER_DATA_ENV.universe);
  if (!/^[1-9]\d{0,15}$/.test(universeId)) throw configurationError(PLAYER_DATA_ENV.universe);
  const apiKey = requiredValue(environment, PLAYER_DATA_ENV.key);
  if (apiKey.length < 16 || apiKey.length > 8192 || /[\s\u0000-\u001f\u007f-\uffff]/.test(apiKey)) throw configurationError(PLAYER_DATA_ENV.key);
  const result = { universeId, apiKey, timeoutMs: GAME_DATA_LIMITS.readTimeoutMs, requestsPerMinute: GAME_DATA_LIMITS.requestsPerMinute };
  if (includeStores) {
    const stores = {};
    for (const mode of ["main", "battlefront"]) {
      const dataStoreId = requiredValue(environment, PLAYER_DATA_ENV[mode]);
      if (!dataStoreId.isWellFormed() || dataStoreId.length > 128 || [".", ".."].includes(dataStoreId) || /[\u0000-\u001f\u007f/\\?#%@]/.test(dataStoreId)) throw configurationError(PLAYER_DATA_ENV[mode]);
      stores[mode] = { dataStoreId, scopeId: "global" };
    }
    if (stores.main.dataStoreId === stores.battlefront.dataStoreId) throw configurationError(PLAYER_DATA_ENV.battlefront);
    result.stores = stores;
  }
  return result;
}

export function readGameDataConfiguration(environment = process.env) {
  // Disabled startup does not inspect the dedicated secret or resource IDs.
  if (!gameDataEnabled(environment)) return { enabled: false, readerConfig: null };
  return { enabled: true, readerConfig: readRobloxDataStoreConfig(environment) };
}
