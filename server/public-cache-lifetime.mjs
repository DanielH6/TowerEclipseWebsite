// A signed URL can already be old when an artifact is sent to a browser/CDN.
// Reserve both the downstream cache lifetime and a network/clock margin.
export function signedPublicCacheTtlMs(maximumMs, downloadSeconds) {
  const seconds = Number.isFinite(downloadSeconds) && downloadSeconds > 0 ? downloadSeconds : 900;
  const downstreamMs = seconds < 120 ? 0 : 60_000;
  return Math.max(0, Math.min(maximumMs, seconds * 1000 - downstreamMs - 30_000));
}
