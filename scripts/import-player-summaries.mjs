import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importOwnerSummaries, validateSummaryImportTarget } from "../server/player-summary-import.mjs";
import { createFirestoreSummaryImportStore } from "../server/player-summary-import-store.mjs";
import { createRobloxProfileReader } from "../server/roblox-profile-reader.mjs";
import { readRobloxDataStoreConfig } from "../server/game-data-config.mjs";

const usage = "node scripts/import-player-summaries.mjs --user-id 404731089\nnode scripts/import-player-summaries.mjs --user-id 404731089 --apply";
const safeCodes = new Set(["INVALID_IMPORT_ARGUMENTS", "INVALID_PLAYER_ID", "IMPORT_TARGET_NOT_ALLOWED", "INVALID_IMPORT_CONFIGURATION", "INVALID_PLAYER_DATA_CONFIG"]);

export async function runOwnerImportCommand({ argv, loadResources, signal }) {
  try {
    let values;
    try {
      const parsed = parseArgs({ args: argv, options: { "user-id": { type: "string" }, apply: { type: "boolean" }, help: { type: "boolean" } }, strict: true, allowPositionals: false, tokens: true });
      const names = parsed.tokens.filter(token => token.kind === "option").map(token => token.name);
      if (new Set(names).size !== names.length) throw new Error("Duplicate importer option.");
      values = parsed.values;
    }
    catch { throw Object.assign(new Error("Invalid importer arguments."), { code: "INVALID_IMPORT_ARGUMENTS" }); }
    if (values.help) return { ok: true, usage };
    validateSummaryImportTarget(values["user-id"]);
    const apply = values.apply === true;
    const resources = await loadResources({ apply });
    return await importOwnerSummaries({ ...resources, userId: values["user-id"], apply, signal });
  } catch (error) { return { ok: false, code: safeCodes.has(error?.code) ? error.code : "IMPORT_SETUP_UNAVAILABLE" }; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try {
    const result = await runOwnerImportCommand({ argv: process.argv.slice(2), signal: controller.signal,
      loadResources: async ({ apply }) => {
        // Load only after exact targeting/arguments have been validated. Existing
        // backend env is supplied by the container or Node --env-file, not argv.
        const configuration = readRobloxDataStoreConfig(process.env);
        const { db } = await import("../server/firebase.mjs");
        return { reader: createRobloxProfileReader({ fetch: globalThis.fetch, config: configuration }),
          store: createFirestoreSummaryImportStore(db, { writeEnabled: apply }) };
      },
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
