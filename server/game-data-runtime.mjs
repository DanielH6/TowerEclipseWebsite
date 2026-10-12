import { createUnavailableProfileReader } from "./game-data-readers.mjs";
import { createRobloxProfileReader } from "./roblox-profile-reader.mjs";

export function createConfiguredProfileReader(configuration, dependencies = {}) {
  if (!configuration.enabled) return createUnavailableProfileReader();
  return createRobloxProfileReader({ ...dependencies,
    fetch: dependencies.fetch ?? globalThis.fetch, config: configuration.readerConfig });
}
