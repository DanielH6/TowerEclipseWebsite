import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const CACHE_VERSION = 1;
const cacheDirectory = process.env.LOCAL_CACHE_DIR
  ? path.resolve(process.env.LOCAL_CACHE_DIR)
  : path.resolve(process.cwd(), ".runtime", "cache");

let warnedReadOnly = false;

function cacheFile(name) {
  return path.join(cacheDirectory, `${name}.json`);
}

export function localCacheDirectory() {
  return cacheDirectory;
}

export function readLocalJsonCache(name) {
  try {
    const parsed = JSON.parse(readFileSync(cacheFile(name), "utf8"));
    if (parsed?.version !== CACHE_VERSION || parsed?.name !== name) return null;
    return parsed.data ?? null;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(`Could not read local cache ${name}; Firestore will be used once to rebuild it.`);
    }
    return null;
  }
}

export function writeLocalJsonCache(name, data) {
  const file = cacheFile(name);
  const temporaryFile = `${file}.${process.pid}.tmp`;

  try {
    mkdirSync(cacheDirectory, { recursive: true });
    writeFileSync(
      temporaryFile,
      JSON.stringify({
        version: CACHE_VERSION,
        name,
        savedAt: new Date().toISOString(),
        data,
      }),
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(temporaryFile, file);
    return true;
  } catch (error) {
    rmSync(temporaryFile, { force: true });
    if (!warnedReadOnly) {
      warnedReadOnly = true;
      console.warn(
        `Local cache could not be written to ${cacheDirectory}. ` +
          "Set LOCAL_CACHE_DIR to a writable directory (for example /tmp/tower-eclipse-cache).",
      );
    }
    return false;
  }
}

export function deleteLocalJsonCache(name) {
  try {
    rmSync(cacheFile(name), { force: true });
  } catch {
    // A cache file is optional; failure to delete it should not break the API.
  }
}
