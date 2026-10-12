import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createImportRunBudget, PROPOSED_IMPORT_BUDGET, validateImportBudget } from "../server/player-import-budget.mjs";
import { runPlayerImportSweep } from "../server/player-import-runner.mjs";
import { createPlayerImportDependencies } from "../server/player-import-runtime.mjs";
import { readRobloxDataStoreConfig } from "../server/game-data-config.mjs";

const names = { "max-profiles": "profiles", "max-reads": "reads", "max-writes": "writes", "max-attempts": "attempts", "max-seconds": "seconds", "retry-profiles": "retryProfiles" };
const usage = "node scripts/run-player-import.mjs --scope main,battlefront --sweep daily --timezone Australia/Sydney --max-profiles 1000 --max-reads 10000 --max-writes 4000 --max-attempts 20000 --max-seconds 1800 --retry-profiles 50 [--apply]\nDefault: dry-run. daily resumes unfinished sweeps and starts a new sweep only after the local day changes. resume never restarts a completed scan. new refuses unfinished scans. --resume-paused explicitly clears an operator stop.";

export function parsePlayerImportRunArguments(argv) {
  const options = { scope: { type: "string" }, sweep: { type: "string", default: "resume" }, timezone: { type: "string", default: "Australia/Sydney" },
    apply: { type: "boolean" }, "resume-paused": { type: "boolean" }, help: { type: "boolean" },
    ...Object.fromEntries(Object.keys(names).map(key => [key, { type: "string" }])) };
  const parsed = parseArgs({ args: argv, options, strict: true, allowPositionals: false, tokens: true });
  const tokens = parsed.tokens.filter(token => token.kind === "option").map(token => token.name);
  if (new Set(tokens).size !== tokens.length) throw new Error("Duplicate importer option.");
  if (parsed.values.help) return { help: true };
  const values = parsed.values;
  if (values.scope !== "main,battlefront" || !["resume", "daily", "new"].includes(values.sweep)) throw new Error("Explicit fixed importer scope is required.");
  if (typeof values.timezone !== "string" || values.timezone.length > 64) throw new Error("Invalid importer timezone.");
  new Intl.DateTimeFormat("en", { timeZone: values.timezone });
  const limits = { ...PROPOSED_IMPORT_BUDGET };
  for (const [flag, key] of Object.entries(names)) {
    if (values.apply && values[flag] === undefined) throw new Error("Apply requires explicit finite budgets.");
    if (values[flag] !== undefined) {
      if (!/^(0|[1-9]\d{0,6})$/.test(values[flag])) throw new Error("Invalid importer budget.");
      limits[key] = Number(values[flag]);
    }
  }
  validateImportBudget(limits);
  return { apply: values.apply === true, intent: values.sweep, timeZone: values.timezone, resumePaused: values["resume-paused"] === true, limits };
}

export async function runPlayerImportCommand({ argv, loadResources, signal, now = Date.now }) {
  let input;
  try { input = parsePlayerImportRunArguments(argv); } catch { return { ok: false, code: "INVALID_IMPORT_RUN_ARGUMENTS" }; }
  if (input.help) return { ok: true, usage };
  const budget = createImportRunBudget(input.limits, { now, signal });
  try {
    const resources = await loadResources({ budget, apply: input.apply });
    return await runPlayerImportSweep({ ...resources, ...input, budget, now });
  } catch { return { ok: false, code: "IMPORT_RUN_SETUP_UNAVAILABLE", writeMode: input.apply ? "apply" : "dry_run", usage: budget.snapshot() }; }
  finally { budget.dispose(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try {
    const result = await runPlayerImportCommand({ argv: process.argv.slice(2), signal: controller.signal, loadResources: async ({ budget }) => {
      // The host supplies its existing private backend environment. No app,
      // bot, analytics, timer, dotenv startup or new credentials are loaded.
      const configuration = { enabled: true, readerConfig: readRobloxDataStoreConfig(process.env) };
      const { db } = await import("../server/firebase.mjs");
      return createPlayerImportDependencies({ configuration, db, projectId: process.env.FIREBASE_PROJECT_ID, budget });
    } });
    console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
