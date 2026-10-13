import { readFileSync, writeFileSync, renameSync, appendFileSync } from "node:fs";
import { createPlayerImportFixtures } from "./player-import-fixtures.mjs";
import { createPlayerImportStore, PLAYER_IMPORT_JOB_PATH } from "../player-import-store.mjs";
import { createImportRunBudget, PROPOSED_IMPORT_BUDGET } from "../player-import-budget.mjs";
import { planDailyImport, DAILY_IMPORT_CHUNK } from "../player-import-schedule.mjs";
import { runPlayerImportSweep } from "../player-import-runner.mjs";

// Subprocess-only persistence fixture. The atomic file models acknowledged
// durable writes across SIGKILL, without credentials or an external transport.
const [file, boundary = "none", phase = "after", instant, dailyFlag = "false"] = process.argv.slice(2);
const now = () => Number(instant);
const fixture = createPlayerImportFixtures({ count: 3, now });
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
globalThis.fetch = () => { throw new Error("External requests are forbidden in the process fixture."); };
try {
  for (const [key, value] of JSON.parse(readFileSync(file, "utf8"))) fixture.records.set(key, value);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (boundary === "retry") fixture.failures.profiles.add(`main:${fixture.ids.main[0]}`);

let paused = false;
const keepAlive = setInterval(() => {}, 1000);
async function pauseAt(path, value, moment) {
  if (paused || moment !== phase) return;
  const matches = boundary === "summary" ? path.startsWith("tePlayerSummaries/")
    : boundary === "retry" ? path.startsWith("tePlayerImportFailures/")
    : path === PLAYER_IMPORT_JOB_PATH && (boundary === "page" ? value.modes.main.pageLoaded && value.modes.main.attempts === 0
      : boundary === "checkpoint" ? value.modes.main.attempts === 1 && value.lease !== null
      : boundary === "finalization" ? value.lease === null : false);
  if (!matches) return;
  paused = true;
  process.send?.({ boundary, phase });
  await new Promise(resolve => {
    if (controller.signal.aborted) resolve();
    else controller.signal.addEventListener("abort", resolve, { once: true });
  });
}
fixture.hooks.beforeSet = async (path, value) => {
  await pauseAt(path, value, "before");
  controller.signal.throwIfAborted();
};
fixture.hooks.afterSet = async (path, value) => {
  writeFileSync(`${file}.next`, JSON.stringify([...fixture.records]));
  renameSync(`${file}.next`, file);
  appendFileSync(`${file}.writes`, `${JSON.stringify({ path, value })}\n`);
  await pauseAt(path, value, "after");
};

const limits = dailyFlag === "true" ? planDailyImport(fixture.records.get(PLAYER_IMPORT_JOB_PATH)?.value, now()).limits ?? DAILY_IMPORT_CHUNK : PROPOSED_IMPORT_BUDGET;
const budget = createImportRunBudget(limits, { now, signal: controller.signal });
try {
  const result = await runPlayerImportSweep({ ...fixture.dependencies, store: createPlayerImportStore(fixture.db, { budget }),
    budget, now, apply: true, intent: "daily", daily: dailyFlag === "true" });
  process.send?.({ result });
} finally {
  budget.dispose();
  clearInterval(keepAlive);
  process.disconnect?.();
}
