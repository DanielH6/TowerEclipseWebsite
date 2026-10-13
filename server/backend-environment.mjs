import { config as loadDotenv } from "dotenv";
import path from "node:path";

// Importing this module is inert. Call only at an executable entry point after
// argument validation; injected variables (including Node --env-file) win.
export function loadBackendEnvironment({ environment = process.env, envPath = path.resolve(".env") } = {}) {
  const result = loadDotenv({ path: envPath, processEnv: environment, override: false, quiet: true });
  if (result.error && result.error.code !== "ENOENT") {
    throw new Error("Backend environment could not be loaded.");
  }
  return environment;
}
