import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadBackendEnvironment } from "./backend-environment.mjs";
import { loadPlayerImportCommandResources } from "../scripts/run-player-import.mjs";
import { createPlayerImportFixtures } from "./testing/player-import-fixtures.mjs";

const exec = promisify(execFile);
const fixtureEnv = `FIREBASE_PROJECT_ID=synthetic-offline-project
ROBLOX_UNIVERSE_ID=123456
ROBLOX_DATASTORE_READ_API_KEY=synthetic-read-key-only
ROBLOX_MAIN_DATASTORE_ID=main-fixture
ROBLOX_BATTLEFRONT_DATASTORE_ID=bf-fixture
`;

test("dotenv loads before source configuration/Firebase, injected values win, and unrelated auth is not validated", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "te-env-"));
  try {
    const envPath = path.join(directory, ".env");
    await writeFile(envPath, fixtureEnv);
    const environment = { ROBLOX_UNIVERSE_ID: "999999", FIREBASE_PROJECT_ID: "injected-project", DISCORD_CLIENT_ID: "invalid-but-unrelated" };
    let loaded = false;
    const resources = await loadPlayerImportCommandResources({ environment, envPath, loadDatabase: async () => {
      loaded = true;
      assert.equal(environment.ROBLOX_MAIN_DATASTORE_ID, "main-fixture");
      assert.equal(environment.ROBLOX_UNIVERSE_ID, "999999");
      return { db: createPlayerImportFixtures().db };
    } });
    assert.equal(loaded, true);
    assert.equal(resources.target.universeId, "999999");
    assert.equal(resources.target.projectId, "injected-project");
    assert.equal(environment.DISCORD_CLIENT_ID, "invalid-but-unrelated");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("loader permits missing .env and masks unreadable file errors", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "te-env-error-"));
  try {
    const environment = { KEEP: "injected" };
    assert.equal(loadBackendEnvironment({ environment, envPath: path.join(directory, "missing") }), environment);
    assert.throws(() => loadBackendEnvironment({ environment, envPath: directory }), { message: "Backend environment could not be loaded." });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real CLI help/invalid arguments and module imports are inert in a fresh process", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "te-cli-inert-"));
  try {
    await writeFile(path.join(directory, ".env"), fixtureEnv + "IMPORT_INERT_SENTINEL=must-not-load\n");
    const scripts = ["run-player-import.mjs", "import-player-summaries.mjs"].map(name => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url)));
    for (const script of scripts) {
      const options = { cwd: directory, env: { PATH: process.env.PATH } };
      const help = await exec(process.execPath, [script, "--help"], options);
      assert.equal(JSON.parse(help.stdout).ok, true);
      await assert.rejects(exec(process.execPath, [script, "--unknown"], options), error => {
        assert.equal(error.code, 1);
        assert.ok(JSON.parse(error.stdout).code.startsWith("INVALID_IMPORT"));
        assert.equal(error.stderr, "");
        return true;
      });
    }
    const code = `import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const read = fs.readFileSync;
      fs.readFileSync = (file, ...args) => {
        if (String(file).endsWith('.env')) throw new Error('Module import must not read dotenv');
        return read(file, ...args);
      };
      syncBuiltinESMExports();
      globalThis.fetch = () => { throw new Error('No network'); };
      await import(${JSON.stringify(new URL("../scripts/run-player-import.mjs", import.meta.url).href)});
      await import(${JSON.stringify(new URL("../scripts/import-player-summaries.mjs", import.meta.url).href)});
      await import(${JSON.stringify(new URL("./player-import-worker.mjs", import.meta.url).href)});
      if (process.env.IMPORT_INERT_SENTINEL) throw new Error('Environment loaded during module import');`;
    const imported = await exec(process.execPath, ["--input-type=module", "-e", code], { cwd: directory, env: { PATH: process.env.PATH } });
    assert.equal(imported.stdout, "");
    assert.equal(imported.stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit Node --env-file remains compatible with built-in loading and shell precedence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "te-env-file-"));
  try {
    const envPath = path.join(directory, ".env");
    await writeFile(envPath, "SYNTHETIC_PRECEDENCE=file\nSYNTHETIC_FROM_FILE=present\n");
    const code = `const { loadBackendEnvironment } = await import(${JSON.stringify(new URL("./backend-environment.mjs", import.meta.url).href)});
      loadBackendEnvironment();
      console.log(JSON.stringify([process.env.SYNTHETIC_PRECEDENCE, process.env.SYNTHETIC_FROM_FILE]));`;
    const result = await exec(process.execPath, [`--env-file=${envPath}`, "--input-type=module", "-e", code], {
      cwd: directory, env: { PATH: process.env.PATH, SYNTHETIC_PRECEDENCE: "injected" },
    });
    assert.deepEqual(JSON.parse(result.stdout), ["injected", "present"]);
    assert.equal(result.stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
