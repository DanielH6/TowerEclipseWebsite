import { createHash } from "node:crypto";
import { createRobloxReadHttp } from "./roblox-read-http.mjs";
import { createRobloxProfileReader } from "./roblox-profile-reader.mjs";
import { createRobloxEntryLister } from "./roblox-entry-list.mjs";
import { createRobloxUserIdentities } from "./roblox-user-identities.mjs";
import { createPlayerImportStore } from "./player-import-store.mjs";
import { createPlayerImportService } from "./player-import-service.mjs";

export function createConfiguredPlayerImport({ configuration, db, secret, projectId, environment = process.env, fetch: request = globalThis.fetch }) {
  const flag = environment.TE_DATA_IMPORT_ENABLED;
  if (![undefined, "", "false", "true"].includes(flag)) throw new Error("TE_DATA_IMPORT_ENABLED must be true or false.");
  const enabled = flag === "true" && configuration.enabled;
  if (!enabled) return createPlayerImportService({ secret, enabled: false });
  return createPlayerImportService(createPlayerImportDependencies({ configuration, db, secret, projectId, fetch: request }));
}

export function createPlayerImportDependencies({ configuration, db, secret, projectId, fetch: request = globalThis.fetch, budget }) {
  if (typeof projectId !== "string" || !/^[a-z0-9-]{1,128}$/.test(projectId)) throw new Error("The importer requires the configured Firestore project.");
  const boundedFetch = budget ? (url, options) => { budget.attempt(); return request(url, options); } : request;
  const options = { config: configuration.readerConfig, fetch: boundedFetch };
  options.http = createRobloxReadHttp(options);
  const target = { experience: "Tower Eclipse", universeId: options.config.universeId, projectId,
    collection: "tePlayerSummaries", stores: { main: "PlayerData V24", battlefront: "PlayerData V1_battlefront" }, scope: "global" };
  const targetFingerprint = createHash("sha256").update(JSON.stringify({ universeId: options.config.universeId, stores: options.config.stores, projectId })).digest("hex");
  return { store: createPlayerImportStore(db, { budget }), reader: createRobloxProfileReader(options), lister: createRobloxEntryLister(options),
    identities: createRobloxUserIdentities({ fetch: boundedFetch }), secret, target, targetFingerprint, enabled: true };
}
