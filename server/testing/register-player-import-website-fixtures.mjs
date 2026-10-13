import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register, syncBuiltinESMExports } from "node:module";

// Used only by integration-test subprocesses. No production module imports this.
const repository = fileURLToPath(new URL("../../", import.meta.url));
const read = fs.readFileSync;
fs.readFileSync = (file, ...args) => {
  const value = file instanceof URL ? fileURLToPath(file) : String(file);
  const relative = path.relative(repository, path.resolve(value));
  if (/^\.env(?:\.|$)/.test(relative) || relative.startsWith(".runtime/") || relative.startsWith("secrets/")) {
    throw new Error("Production environment/runtime reads are forbidden in website integration tests.");
  }
  return read(file, ...args);
};
syncBuiltinESMExports();
const request = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("External network is forbidden in website integration tests.");
  }
  return request(input, options);
};
Date.now = () => Number(process.env.TE_FIXTURE_NOW);
register(new URL("./player-import-website-loader.mjs", import.meta.url), import.meta.url);
