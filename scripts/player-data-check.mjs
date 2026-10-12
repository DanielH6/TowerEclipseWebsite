import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gameDataEnabled, PLAYER_DATA_ENV, GAME_DATA_STORES, readRobloxDataStoreConfig } from "../server/game-data-config.mjs";
import { decodeSavedProfile, validatePlayerId } from "../server/game-data-domain.mjs";
import { createRobloxProfileReader } from "../server/roblox-profile-reader.mjs";
import { createRobloxReadHttp } from "../server/roblox-read-http.mjs";

// Importing this script is inert. It never imports production config, Firebase,
// analytics, auth/session files or dotenv; Node's --env-file is the host loader.
const usage = "node --env-file=/private/path/player-data.env scripts/player-data-check.mjs discover --confirm-read-only\nnode --env-file=/private/path/player-data.env scripts/player-data-check.mjs smoke --user-id OWNER_USER_ID --confirm-read-only";
const safeCodes = new Set(["INVALID_PLAYER_DATA_CONFIG", "INVALID_PLAYER_ID", "INVALID_ARGUMENTS", "CONFIRM_READ_ONLY_REQUIRED", "VIEWER_MUST_BE_DISABLED", "DISCOVERY_INCOMPLETE", "READ_ACCESS_DENIED", "READ_ABORTED", "READ_RATE_LIMITED", "READ_UNAVAILABLE", "READ_LIMIT", "INVALID_PROFILE", "READER_NOT_CONFIGURED"]);
const error = code => Object.assign(new Error("The player-data check could not complete."), { code });

function safeFailure(failure) {
  const result = { ok: false, code: safeCodes.has(failure?.code) ? failure.code : "READ_UNAVAILABLE" };
  if (["TE_DATA_VIEWER_ENABLED", ...Object.values(PLAYER_DATA_ENV)].includes(failure?.variable)) result.variable = failure.variable;
  return result;
}

function matchingStore(body, universeId, expectedName) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || (body.dataStores !== undefined && (!Array.isArray(body.dataStores) || body.dataStores.length > 25))
    || (body.nextPageToken !== undefined && typeof body.nextPageToken !== "string")) throw error("INVALID_PROFILE");
  const matches = (body.dataStores ?? []).filter(store => store?.id === expectedName);
  if (matches.length > 1) throw error("INVALID_PROFILE");
  const match = matches[0];
  if (match) {
    if (![undefined, "STATE_UNSPECIFIED", "ACTIVE"].includes(match.state)) throw error("INVALID_PROFILE");
    if (match.path !== undefined) {
      let normalized;
      try { normalized = match.path.split("/").map(decodeURIComponent).join("/"); } catch { throw error("INVALID_PROFILE"); }
      if (normalized !== `universes/${universeId}/data-stores/${expectedName}`) throw error("INVALID_PROFILE");
    }
  }
  // Output only the two exact known names, never arbitrary returned store text.
  return { expectedName, resourceId: match?.id ?? null, resourceReturned: Boolean(match),
    pathPresent: typeof match?.path === "string", incompletePage: Boolean(body.nextPageToken) };
}

export async function runPlayerDataCheck({ argv, environment, fetch: request, signal, now, wait, random }) {
  try {
    let argumentsParsed;
    try { argumentsParsed = parseArgs({ args: argv, options: { "confirm-read-only": { type: "boolean" }, "user-id": { type: "string" }, help: { type: "boolean" } }, allowPositionals: true, strict: true }); }
    catch { throw error("INVALID_ARGUMENTS"); }
    const { values, positionals } = argumentsParsed;
    if (values.help) return { ok: true, usage };
    if (positionals.length !== 1 || !["discover", "smoke"].includes(positionals[0]) || (positionals[0] === "discover" && values["user-id"] !== undefined)) throw error("INVALID_ARGUMENTS");
    if (!values["confirm-read-only"]) throw error("CONFIRM_READ_ONLY_REQUIRED");
    if (gameDataEnabled(environment)) throw error("VIEWER_MUST_BE_DISABLED");
    const command = positionals[0];
    if (command === "smoke") validatePlayerId(values["user-id"]);
    const configuration = readRobloxDataStoreConfig(environment, { includeStores: command === "smoke" });
    const dependencies = { fetch: request, config: configuration, ...(now ? { now } : {}), ...(wait ? { wait } : {}), ...(random ? { random } : {}) };
    if (command === "discover") {
      const http = createRobloxReadHttp(dependencies), stores = [];
      for (const mode of ["main", "battlefront"]) {
        const expectedName = GAME_DATA_STORES[mode].name;
        const body = await http.get(["data-stores"], { signal, maxBytes: 65536,
          query: { maxPageSize: "25", filter: `id.startsWith(${JSON.stringify(expectedName)})` } });
        stores.push({ mode, ...matchingStore(body, configuration.universeId, expectedName) });
      }
      const ok = stores.every(store => store.resourceReturned && !store.incompletePage);
      return { ok, command, configuredUniverseId: configuration.universeId, universeOwnershipVerified: false,
        stores, ...(!ok ? { code: "DISCOVERY_INCOMPLETE" } : {}) };
    }
    const reader = createRobloxProfileReader(dependencies), modes = [];
    for (const mode of ["main", "battlefront"]) {
      try {
        const entry = await reader.read(mode, values["user-id"], { signal });
        if (entry === null) { modes.push({ mode, status: "missing", reason: "explicit_deleted_resource" }); continue; }
        decodeSavedProfile(mode, values["user-id"], entry);
        modes.push({ mode, status: "ready", profileEnvelopeValid: true, revisionPresent: entry.revision !== null,
          saveTimestamp: entry.updatedAt, expandedDetailReturned: false });
      } catch (failure) { modes.push({ mode, status: "unavailable", code: safeFailure(failure).code }); }
      if (signal?.aborted) break;
    }
    return { ok: modes.length === 2 && modes.every(mode => mode.status === "ready"), command,
      configuredUniverseId: configuration.universeId, ownerIdValidated: true, modes };
  } catch (failure) { return safeFailure(failure); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try {
    const result = await runPlayerDataCheck({ argv: process.argv.slice(2), environment: process.env, fetch: globalThis.fetch, signal: controller.signal });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
