import assert from "node:assert/strict";
import test from "node:test";
import { createRobloxStatsService } from "./roblox-stats.mjs";

const universeId = "6466960954";
const fixedNow = new Date("2026-07-30T03:00:00.000Z");

function analyticsResult(value, time = "2026-07-29T00:00:00.000Z") {
  return {
    done: true,
    response: {
      values: [{
        breakdowns: [],
        dataPoints: [{ time, value }],
      }],
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("uses public live visits and CCU with private analytics MAU", async () => {
  const fetchImpl = async (url, options = {}) => {
    if (String(url).startsWith("https://games.roblox.com/")) {
      return jsonResponse({
        data: [{
          id: Number(universeId),
          visits: 42137,
          playing: 18,
          isContentRestricted: false,
        }],
      });
    }

    const request = JSON.parse(options.body);
    if (request.metric === "Visits") return jsonResponse(analyticsResult(42000));
    if (request.metric === "MonthlyActiveUsers") {
      return jsonResponse(analyticsResult(143));
    }
    if (request.metric === "PeakConcurrentPlayers") {
      return jsonResponse(analyticsResult(24));
    }
    throw new Error(`Unexpected request: ${request.metric}`);
  };
  const service = createRobloxStatsService({
    universeId,
    openCloudApiKey: "test-key",
    fetchImpl,
    now: () => new Date(fixedNow),
  });

  const stats = await service.getStats();

  assert.equal(stats.totalPlays, 42137);
  assert.equal(stats.monthlyPlayers, 143);
  assert.equal(stats.ccu, 18);
  assert.equal(stats.ccuMode, "current");
  assert.equal(stats.partial, false);
});

test("falls back to analytics visits and 28-day peak for restricted games", async () => {
  const fetchImpl = async (url, options = {}) => {
    if (String(url).startsWith("https://games.roblox.com/")) {
      return jsonResponse({
        data: [{
          id: 0,
          visits: 0,
          playing: 0,
          isContentRestricted: true,
        }],
      });
    }

    const request = JSON.parse(options.body);
    if (request.metric === "Visits") return jsonResponse(analyticsResult(42137));
    if (request.metric === "MonthlyActiveUsers") {
      return jsonResponse(analyticsResult(143));
    }
    if (request.metric === "PeakConcurrentPlayers") {
      return jsonResponse({
        done: true,
        response: {
          values: [{
            dataPoints: [
              { time: "2026-07-28T00:00:00.000Z", value: 21 },
              { time: "2026-07-29T00:00:00.000Z", value: 24 },
            ],
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${request.metric}`);
  };
  const service = createRobloxStatsService({
    universeId,
    openCloudApiKey: "test-key",
    fetchImpl,
    now: () => new Date(fixedNow),
  });

  const stats = await service.getStats();

  assert.equal(stats.totalPlays, 42137);
  assert.equal(stats.monthlyPlayers, 143);
  assert.equal(stats.ccu, 24);
  assert.equal(stats.ccuMode, "peak28d");
  assert.equal(stats.peakCcuWindowDays, 28);
});

test("caches a Roblox snapshot for repeated website loads", async () => {
  let requestCount = 0;
  const fetchImpl = async (url, options = {}) => {
    requestCount += 1;
    if (String(url).startsWith("https://games.roblox.com/")) {
      return jsonResponse({
        data: [{
          id: Number(universeId),
          visits: 100,
          playing: 5,
          isContentRestricted: false,
        }],
      });
    }

    const request = JSON.parse(options.body);
    return jsonResponse(analyticsResult(
      request.metric === "MonthlyActiveUsers" ? 10 : 100,
    ));
  };
  const service = createRobloxStatsService({
    universeId,
    openCloudApiKey: "test-key",
    fetchImpl,
    now: () => new Date(fixedNow),
  });

  await service.getStats();
  await service.getStats();

  assert.equal(requestCount, 4);
});
