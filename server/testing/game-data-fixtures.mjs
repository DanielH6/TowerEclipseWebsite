import { projectPlayerSummary } from "../game-data-domain.mjs";
import { GAME_DATA_SORTS } from "../game-data-config.mjs";

export const FIXTURE_PLAYER_ID = "900000000000001";
export function createGameDataFixtures({ count = 1120, now = Date.now } = {}) {
  const entries = new Map(), summaries = [];
  for (let index = 0; index < count; index++) {
    const userId = String(BigInt(FIXTURE_PLAYER_ID) + BigInt(index));
    for (const mode of ["main", "battlefront"]) {
      if (mode === "battlefront" && index % 4 === 3) continue;
      const data = {
        UserId: userId, Name: `Preview_${String(index + 1).padStart(4, "0")}`, DisplayName: `Preview Commander ${String(index + 1).padStart(4, "0")}`,
        Level: index === 4 ? undefined : 120 - index % 120, Experience: 2400 + index, EclipseLevel: 2,
        Games_Played: 180 + index, Losses: 24, Credits: 42500, Cores: 18, Tokens: 6500,
        Total_Credits_Earned: 122500, Total_Cores_Earned: 71,
        Triumphs: { Total: 156, Survival: { Normal: 96, Hard: 45, Mastery: 15 } },
        Ranked: { CurrentISR: 1520 + index % 300, HighestISR: 1810, Games_Played: 82 },
        EndlessData: { RecordWave: 74 }, EnemyData: { Kills: { Raider: 12300, Warden: 4200 } },
        PlayTime: { InGame: 48200, WholeGame: 54100 }, Account: { GamesPlayed: 85 + index },
        Gamemodes: { Normal: { Triumphs: 42, Attempts: 56 }, Hard: { Triumphs: 14, Attempts: 24 }, Mastery: { Triumphs: 4, Attempts: 12 } },
        First_Joined: "14/07/25", Last_Joined: "10/10/26",
        Loadouts: { Active: "Primary", Primary: { Towers: ["Scout", "Medic"], Colours: { Scout: "Blue" } } },
        MatchHistory: [{ Id: "synthetic-match", Mode: "Normal", Wave: 32, Outcome: "Victory", Players: ["unrelated-fixture-identity"], Session: "fixture-private-session" }],
        Rejoin: "fixture-private-reservation", Receipts: ["fixture-private-receipt"],
        Nested: { API_Key: "fixture-private-marker", Progress: 12 }, PendingGift: { Message: "fixture-private-message" },
      };
      const updatedAt = new Date(now() - (index % 7 + 1) * 3600000).toISOString();
      const entry = { envelope: { Data: data, MetaData: { ActiveSession: ["fixture-place", "fixture-job"] }, GlobalUpdates: [] }, updatedAt, revision: `fixture-${mode}-${index}`, checkedAt: new Date(now()).toISOString() };
      entries.set(`${mode}:${userId}`, entry);
      summaries.push(projectPlayerSummary(mode, userId, data, entry));
    }
  }
  const failed = new Set();
  const reader = { synthetic: true, async read(mode, userId) {
    if (failed.has(`${mode}:${userId}`) || mode === "battlefront" && userId === String(BigInt(FIXTURE_PLAYER_ID) + 1n)) throw new Error("Synthetic unavailable fixture");
    return entries.get(`${mode}:${userId}`) ?? null;
  } };
  const fieldValue = (value, field) => field.split(".").reduce((item, key) => item?.[key], value);
  const compare = (left, right) => left === right ? 0 : left === null || left === undefined ? -1 : right === null || right === undefined ? 1 : left < right ? -1 : 1;
  const summaryIndex = { async list(query, page) {
    const field = GAME_DATA_SORTS[query.sort], direction = query.order === "desc" ? -1 : 1;
    const matching = summaries.filter(item => item.mode === query.mode && (!query.search || fieldValue(item, field)?.startsWith(query.search)) && (query.minLevel === null || item.stats.level !== null && item.stats.level >= query.minLevel))
      .sort((left, right) => direction * (compare(fieldValue(left, field), fieldValue(right, field)) || compare(`${left.mode}:${left.userId}`, `${right.mode}:${right.userId}`)));
    const pageItems = page.after ? matching.filter(item => direction * (compare(fieldValue(item, field), page.after[0]) || compare(`${item.mode}:${item.userId}`, page.after[1])) > 0) : matching;
    return { items: pageItems.slice(0, query.limit + 1), coverage: { status: "synthetic", indexedRecords: matching.length, description: `${count.toLocaleString()} fictional players in the isolated preview. This is not production coverage.` } };
  } };
  return { reader, summaryIndex, fail: (mode, userId) => failed.add(`${mode}:${userId}`) };
}
