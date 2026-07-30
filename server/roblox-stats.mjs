const ANALYTICS_ROOT = "https://apis.roblox.com/analytics-query-api";
const PUBLIC_GAMES_ROOT = "https://games.roblox.com/v1/games";
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const ANALYTICS_RETENTION_DAYS = 1460;
const MONTHLY_LOOKBACK_DAYS = 35;
const PEAK_CCU_LOOKBACK_DAYS = 28;
const MAX_POLL_ATTEMPTS = 5;

export class RobloxStatsError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "RobloxStatsError";
  }
}

function startOfUtcDay(value) {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}

function daysBefore(value, days) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

function finiteCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.round(count) : null;
}

function dataPoints(response) {
  if (!Array.isArray(response?.values)) {
    return [];
  }

  return response.values.flatMap((series) => (
    Array.isArray(series?.dataPoints) ? series.dataPoints : []
  ));
}

export function latestMetricValue(response) {
  const points = dataPoints(response)
    .map((point) => ({
      time: Date.parse(point?.time),
      value: finiteCount(point?.value),
    }))
    .filter((point) => Number.isFinite(point.time) && point.value !== null)
    .sort((left, right) => left.time - right.time);

  return points.at(-1)?.value ?? null;
}

export function maximumMetricValue(response) {
  const values = dataPoints(response)
    .map((point) => finiteCount(point?.value))
    .filter((value) => value !== null);

  return values.length > 0 ? Math.max(...values) : null;
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

async function fetchJson(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();

  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const detail =
        body?.error?.message ||
        body?.message ||
        `HTTP ${response.status}`;
      throw new RobloxStatsError(`Roblox API request failed: ${detail}`);
    }

    if (!body || typeof body !== "object") {
      throw new RobloxStatsError("Roblox API returned an invalid JSON response.");
    }

    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new RobloxStatsError("Roblox API request timed out.", { cause: error });
    }

    if (error instanceof RobloxStatsError) {
      throw error;
    }

    throw new RobloxStatsError("Could not reach the Roblox API.", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

function operationPath(universeId, path) {
  const normalized = typeof path === "string"
    ? path.replace(/^\/+/, "")
    : "";
  const requiredPrefix =
    `v1/universes/${universeId}/operations/metrics/`;

  if (!normalized.startsWith(requiredPrefix)) {
    throw new RobloxStatsError(
      "Roblox Analytics returned an unexpected polling path.",
    );
  }

  return `${ANALYTICS_ROOT}/${normalized}`;
}

async function finishOperation(fetchImpl, universeId, apiKey, initial) {
  let operation = initial;

  for (let attempt = 0; operation?.done === false; attempt += 1) {
    if (attempt >= MAX_POLL_ATTEMPTS) {
      throw new RobloxStatsError("Roblox Analytics did not finish in time.");
    }

    await delay(200 * 2 ** attempt);
    operation = await fetchJson(
      fetchImpl,
      operationPath(universeId, operation.path),
      {
        headers: {
          Accept: "application/json",
          "x-api-key": apiKey,
        },
      },
    );
  }

  if (operation?.error) {
    throw new RobloxStatsError(
      `Roblox Analytics query failed: ${operation.error.message ?? "Unknown error"}`,
    );
  }

  if (operation?.done !== true || !operation.response) {
    throw new RobloxStatsError("Roblox Analytics returned an incomplete result.");
  }

  return operation.response;
}

async function queryMetric(
  fetchImpl,
  { universeId, apiKey, metric, granularity, startTime, endTime },
) {
  const operation = await fetchJson(
    fetchImpl,
    `${ANALYTICS_ROOT}/v1/universes/${universeId}/metrics`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        metric,
        granularity,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      }),
    },
  );

  return finishOperation(fetchImpl, universeId, apiKey, operation);
}

async function loadPublicGame(fetchImpl, universeId) {
  const url = new URL(PUBLIC_GAMES_ROOT);
  url.searchParams.set("universeIds", universeId);
  const body = await fetchJson(fetchImpl, url);
  const game = Array.isArray(body.data) ? body.data[0] : null;

  if (
    !game ||
    String(game.id) !== universeId ||
    game.isContentRestricted === true
  ) {
    return null;
  }

  return {
    visits: finiteCount(game.visits),
    playing: finiteCount(game.playing),
  };
}

function settledValue(result, selector) {
  return result.status === "fulfilled" ? selector(result.value) : null;
}

export function createRobloxStatsService({
  universeId,
  openCloudApiKey,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  cacheTtlMs = CACHE_TTL_MS,
} = {}) {
  if (!universeId || !/^\d+$/.test(universeId)) {
    throw new RobloxStatsError("A numeric Roblox universe ID is required.");
  }

  if (typeof fetchImpl !== "function") {
    throw new RobloxStatsError("A fetch implementation is required.");
  }

  let cachedStats = null;
  let cacheExpiresAt = 0;
  let activeRefresh = null;

  async function refresh() {
    const requestedAt = now();
    const analyticsEnd = startOfUtcDay(requestedAt);
    const publicGamePromise = loadPublicGame(fetchImpl, universeId);

    const analyticsPromises = openCloudApiKey
      ? [
          queryMetric(fetchImpl, {
            universeId,
            apiKey: openCloudApiKey,
            metric: "Visits",
            granularity: "None",
            startTime: daysBefore(analyticsEnd, ANALYTICS_RETENTION_DAYS),
            endTime: analyticsEnd,
          }),
          queryMetric(fetchImpl, {
            universeId,
            apiKey: openCloudApiKey,
            metric: "MonthlyActiveUsers",
            granularity: "OneDay",
            startTime: daysBefore(analyticsEnd, MONTHLY_LOOKBACK_DAYS),
            endTime: analyticsEnd,
          }),
          queryMetric(fetchImpl, {
            universeId,
            apiKey: openCloudApiKey,
            metric: "PeakConcurrentPlayers",
            granularity: "OneDay",
            startTime: daysBefore(analyticsEnd, PEAK_CCU_LOOKBACK_DAYS),
            endTime: analyticsEnd,
          }),
        ]
      : [];

    const [publicResult, ...analyticsResults] = await Promise.allSettled([
      publicGamePromise,
      ...analyticsPromises,
    ]);
    const publicGame =
      publicResult.status === "fulfilled" ? publicResult.value : null;
    const visitsFromAnalytics = analyticsResults[0]
      ? settledValue(analyticsResults[0], latestMetricValue)
      : null;
    const monthlyPlayers = analyticsResults[1]
      ? settledValue(analyticsResults[1], latestMetricValue)
      : null;
    const peakCcu = analyticsResults[2]
      ? settledValue(analyticsResults[2], maximumMetricValue)
      : null;
    const totalPlays = publicGame?.visits ?? visitsFromAnalytics;
    const currentCcu = publicGame?.playing ?? null;
    const ccu = currentCcu ?? peakCcu;
    const ccuMode = currentCcu !== null ? "current" : "peak28d";

    if (totalPlays === null && monthlyPlayers === null && ccu === null) {
      const failure = [publicResult, ...analyticsResults]
        .find((result) => result.status === "rejected");
      throw new RobloxStatsError(
        openCloudApiKey
          ? "Roblox did not return any game statistics."
          : "Roblox analytics is not configured. Add ROBLOX_OPEN_CLOUD_API_KEY to .env.",
        failure?.status === "rejected" ? { cause: failure.reason } : {},
      );
    }

    return {
      totalPlays,
      monthlyPlayers,
      ccu,
      ccuMode,
      peakCcuWindowDays:
        ccuMode === "peak28d" ? PEAK_CCU_LOOKBACK_DAYS : null,
      partial:
        totalPlays === null || monthlyPlayers === null || ccu === null,
      stale: false,
      updatedAt: requestedAt.toISOString(),
    };
  }

  async function getStats() {
    const currentTime = now().getTime();

    if (cachedStats && currentTime < cacheExpiresAt) {
      return cachedStats;
    }

    if (activeRefresh) {
      return activeRefresh;
    }

    activeRefresh = refresh()
      .then((stats) => {
        cachedStats = stats;
        cacheExpiresAt = now().getTime() + cacheTtlMs;
        return stats;
      })
      .catch((error) => {
        if (cachedStats) {
          return { ...cachedStats, stale: true };
        }
        throw error;
      })
      .finally(() => {
        activeRefresh = null;
      });

    return activeRefresh;
  }

  return Object.freeze({ getStats });
}
