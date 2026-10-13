const resources = new URL("./player-import-website-resources.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  // Replace only external-resource adapters, never index, worker or runner.
  if (result.url.endsWith("/server/firebase.mjs") || result.url.endsWith("/server/player-import-runtime.mjs")) {
    return { url: resources, shortCircuit: true };
  }
  return result;
}
