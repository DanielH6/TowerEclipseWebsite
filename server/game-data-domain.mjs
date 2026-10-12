import { GAME_DATA_LIMITS, GAME_DATA_STORES } from "./game-data-config.mjs";

export function gameDataError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export function validatePlayerId(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,15}$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw gameDataError(400, "INVALID_PLAYER_ID", "Enter a positive Roblox UserId containing only digits.");
  }
  return value;
}

const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
const text = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 64) : null;
const timestamp = value => typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export const foldIdentity = value => value?.normalize("NFKC").toLowerCase() ?? "";

function savedDate(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  const candidate = match ? `20${match[3]}-${match[2]}-${match[1]}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : null;
}

// Fixture-only expanded detail. This denylist is not a live-data disclosure
// boundary; decodeSavedProfile always withholds arbitrary Data.
function sensitiveField(key) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (normalized === "tokens") return key !== "Tokens";
  return /secret|password|credential|apikey|accesskey|signingkey|serviceaccount|webhook|bearer|auth|cookie|token|receipt|purchaseid|reserved|rejoin|jobid|session|private|developernote|adminnote|internalnote|moderation|staffnote|email|phone|ipaddress/.test(normalized)
    || ["globalupdates", "robloxmetadata", "metadata", "userids", "players", "author", "discordid", "pendinggift", "giftmessage", "privatemessages", "ip", "ipaddr"].includes(normalized);
}

export function redactGameData(input, limits = GAME_DATA_LIMITS) {
  let nodes = 0;
  let removed = 0;
  function visit(value, depth) {
    if (++nodes > limits.maxNodes || depth > limits.maxDepth) throw gameDataError(502, "INVALID_PROFILE", "The saved profile exceeds the viewer's safe decoding limits.");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1));
    if (value && typeof value === "object") {
      const result = Object.create(null);
      for (const [key, item] of Object.entries(value)) {
        if (["__proto__", "prototype", "constructor"].includes(key) || sensitiveField(key) || (key === "Tokens" && number(item) === null)) { removed++; continue; }
        result[key] = visit(item, depth + 1);
      }
      return result;
    }
    return null;
  }
  return { data: visit(input, 0), removedFields: removed };
}

export function projectPlayerSummary(mode, userId, data, source = {}) {
  const playTime = data.PlayTime ?? {};
  const stats = {
    level: number(data.Level), experience: number(data.Experience),
    gamesPlayed: number(mode === "main" ? data.Games_Played : data.Account?.GamesPlayed),
    playTimeInGameSeconds: number(playTime.InGame),
    playTimeWholeGameSeconds: number(playTime.WholeGame),
  };
  if (mode === "main") {
    Object.assign(stats, {
      eclipseLevel: number(data.EclipseLevel), credits: number(data.Credits), cores: number(data.Cores),
      totalCreditsEarned: number(data.Total_Credits_Earned), totalCoresEarned: number(data.Total_Cores_Earned),
      losses: number(data.Losses), triumphsTotal: number(data.Triumphs?.Total),
      normalTriumphs: number(data.Triumphs?.Survival?.Normal), hardTriumphs: number(data.Triumphs?.Survival?.Hard),
      masteryTriumphs: number(data.Triumphs?.Survival?.Mastery), rankedISR: number(data.Ranked?.CurrentISR),
      highestISR: number(data.Ranked?.HighestISR), rankedGamesPlayed: number(data.Ranked?.Games_Played),
      endlessRecordWave: number(data.EndlessData?.RecordWave),
      personalEnemyKillsTotal: data.EnemyData?.Kills && typeof data.EnemyData.Kills === "object"
        ? (Object.values(data.EnemyData.Kills).every(count => number(count) !== null) ? number(Object.values(data.EnemyData.Kills).reduce((sum, count) => sum + count, 0)) : null) : null,
    });
  } else {
    stats.tokens = number(data.Tokens);
    for (const difficulty of ["Normal", "Hard", "Mastery"]) {
      stats[`${difficulty.toLowerCase()}Triumphs`] = number(data.Gamemodes?.[difficulty]?.Triumphs);
      stats[`${difficulty.toLowerCase()}Attempts`] = number(data.Gamemodes?.[difficulty]?.Attempts);
    }
    stats.retainedHistoryCount = Array.isArray(data.MatchHistory) ? Math.min(50, data.MatchHistory.length) : null;
  }
  const username = text(data.Name), displayName = text(data.DisplayName);
  return {
    schemaVersion: 1, mode, userId,
    identity: { username, displayName, usernameFolded: foldIdentity(username), displayNameFolded: foldIdentity(displayName), source: "saved_fields" },
    stats, firstJoinedDate: savedDate(data.First_Joined), lastJoinedDate: savedDate(data.Last_Joined),
    source: { storeName: GAME_DATA_STORES[mode].name, scope: "global", key: userId, revision: text(source.revision), updatedAt: timestamp(source.updatedAt), checkedAt: timestamp(source.checkedAt) },
    missingFields: Object.keys(stats).filter(key => stats[key] === null),
  };
}

export function decodeSavedProfile(mode, userId, entry, limits = GAME_DATA_LIMITS) {
  const envelope = entry.envelope;
  if (!envelope || typeof envelope !== "object" || !envelope.Data || Array.isArray(envelope.Data) || typeof envelope.Data !== "object") {
    throw gameDataError(502, "INVALID_PROFILE", "The saved profile format is not supported.");
  }
  if (Buffer.byteLength(JSON.stringify(envelope)) > limits.maxProfileBytes) throw gameDataError(502, "INVALID_PROFILE", "The saved profile exceeds the viewer's size limit.");
  const source = { revision: entry.revision, updatedAt: entry.updatedAt, checkedAt: entry.checkedAt };
  // Expanded arbitrary Data is intentionally withheld until a detail schema is
  // approved. Only the explicit statistics/identity summary allowlist can leave
  // this boundary, regardless of a caller's future live reader configuration.
  return { summary: projectPlayerSummary(mode, userId, envelope.Data, source), detail: null, detailStatus: "withheld_pending_schema", removedFields: 0 };
}
