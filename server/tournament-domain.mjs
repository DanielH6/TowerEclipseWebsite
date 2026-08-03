import crypto from "node:crypto";

export const TOURNAMENT_STATUSES = ["draft", "scheduled", "live", "completed", "archived"];
export const REGISTRATION_STATUSES = ["open", "closed", "invite_only"];
export const PARTICIPANT_STATUSES = ["confirmed", "waitlist", "withdrawn"];
export const MATCH_STATUSES = ["scheduled", "live", "completed"];

const MAX_PARTICIPANTS = 256;
const MAX_LOG_ENTRIES = 200;
const MAX_GENERATED_GROUP_MATCHES = 600;

export class TournamentError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "TournamentError";
    this.status = status;
  }
}

function fail(status, message) {
  throw new TournamentError(status, message);
}

function clone(value) {
  return structuredClone(value);
}

function cleanText(value, field, { min = 0, max = 5000, fallback } = {}) {
  if ((value === undefined || value === null) && fallback !== undefined) return fallback;
  if (typeof value !== "string") fail(400, `${field} must be text.`);
  const result = value.trim();
  if (result.length < min) fail(400, `${field} must be at least ${min} characters.`);
  if (result.length > max) fail(400, `${field} must be at most ${max} characters.`);
  return result;
}

function cleanOptionalText(value, field, max = 5000) {
  if (value === undefined || value === null || value === "") return "";
  return cleanText(value, field, { max });
}

function cleanInteger(value, field, { min, max, fallback } = {}) {
  const number = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(number)) fail(400, `${field} must be a whole number.`);
  if (min !== undefined && number < min) fail(400, `${field} must be at least ${min}.`);
  if (max !== undefined && number > max) fail(400, `${field} must be at most ${max}.`);
  return number;
}

function cleanBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(400, "Boolean setting is invalid.");
  return value;
}

function cleanEnum(value, field, values, fallback) {
  const result = value ?? fallback;
  if (!values.includes(result)) fail(400, `${field} is invalid.`);
  return result;
}

function cleanIsoDate(value, field, fallback) {
  const result = value ?? fallback;
  const date = new Date(result);
  if (!result || Number.isNaN(date.getTime())) fail(400, `${field} must be a valid date and time.`);
  return date.toISOString();
}

function cleanUrl(value, field) {
  if (value === undefined || value === null || value === "") return "";
  const result = cleanText(value, field, { max: 1000 });
  let url;
  try {
    url = new URL(result);
  } catch {
    fail(400, `${field} must be a valid web address.`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    fail(400, `${field} must use http or https.`);
  }
  return url.toString();
}

export function normalizeTournamentSlug(value) {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (slug.length < 3) fail(400, "slug must contain at least 3 letters or numbers.");
  return slug;
}

function actorSnapshot(actor) {
  if (!actor) return null;
  return {
    discordId: String(actor.discordUser?.id ?? actor.id ?? ""),
    displayName: String(
      actor.discordMember?.nick
        ?? actor.discordUser?.global_name
        ?? actor.displayName
        ?? actor.discordUser?.username
        ?? "Tournament staff",
    ),
  };
}

function defaultSettings(input = {}, current = {}) {
  return {
    participantCap: cleanInteger(input.participantCap, "participantCap", {
      min: 2,
      max: MAX_PARTICIPANTS,
      fallback: current.participantCap ?? 32,
    }),
    groupCount: cleanInteger(input.groupCount, "groupCount", {
      min: 1,
      max: 64,
      fallback: current.groupCount ?? 8,
    }),
    qualifiersPerGroup: cleanInteger(input.qualifiersPerGroup, "qualifiersPerGroup", {
      min: 1,
      max: 16,
      fallback: current.qualifiersPerGroup ?? 2,
    }),
    pointsWin: cleanInteger(input.pointsWin, "pointsWin", {
      min: -20,
      max: 100,
      fallback: current.pointsWin ?? 3,
    }),
    pointsDraw: cleanInteger(input.pointsDraw, "pointsDraw", {
      min: -20,
      max: 100,
      fallback: current.pointsDraw ?? 1,
    }),
    pointsLoss: cleanInteger(input.pointsLoss, "pointsLoss", {
      min: -20,
      max: 100,
      fallback: current.pointsLoss ?? 0,
    }),
    allowDraws: cleanBoolean(input.allowDraws, current.allowDraws ?? true),
    autoAdvance: cleanBoolean(input.autoAdvance, current.autoAdvance ?? true),
    groupBestOf: cleanInteger(input.groupBestOf, "groupBestOf", {
      min: 1,
      max: 99,
      fallback: current.groupBestOf ?? 1,
    }),
    knockoutBestOf: cleanInteger(input.knockoutBestOf, "knockoutBestOf", {
      min: 1,
      max: 99,
      fallback: current.knockoutBestOf ?? 3,
    }),
    thirdPlaceMatch: cleanBoolean(input.thirdPlaceMatch, current.thirdPlaceMatch ?? false),
    checkInRequired: cleanBoolean(input.checkInRequired, current.checkInRequired ?? false),
    seedingMode: cleanEnum(
      input.seedingMode,
      "seedingMode",
      ["random", "balanced", "manual"],
      current.seedingMode ?? "random",
    ),
    tiebreakers: ["points", "scoreDifference", "scoreFor", "wins", "headToHead", "seed"],
  };
}

function validateTournamentDates(startsAt, endsAt) {
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    fail(400, "The tournament end must be after its start.");
  }
}

function touch(tournament, actor, now) {
  tournament.updatedAt = now;
  tournament.updatedBy = actorSnapshot(actor);
  tournament.version = Number(tournament.version ?? 0) + 1;
  return tournament;
}

function addLog(tournament, entry, { idFactory = () => crypto.randomUUID(), now } = {}) {
  tournament.log = [
    {
      id: idFactory(),
      type: entry.type,
      headline: entry.headline,
      detail: entry.detail ?? "",
      stage: entry.stage ?? null,
      matchId: entry.matchId ?? null,
      participantIds: entry.participantIds ?? [],
      score: entry.score ?? null,
      createdAt: now,
      recordedBy: entry.recordedBy ?? null,
    },
    ...(tournament.log ?? []),
  ].slice(0, MAX_LOG_ENTRIES);
}

export function createTournament(input, {
  id = crypto.randomUUID(),
  idFactory = () => crypto.randomUUID(),
  actor = null,
  now = new Date().toISOString(),
} = {}) {
  const name = cleanText(input.name, "name", { min: 3, max: 120 });
  const slug = normalizeTournamentSlug(input.slug || name);
  const startsAt = cleanIsoDate(input.startsAt, "startsAt", now);
  const endsAt = cleanIsoDate(
    input.endsAt,
    "endsAt",
    new Date(new Date(startsAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  );
  validateTournamentDates(startsAt, endsAt);
  const createdBy = actorSnapshot(actor);

  const tournament = {
    id,
    slug,
    name,
    tagline: cleanOptionalText(input.tagline, "tagline", 180),
    description: cleanOptionalText(input.description, "description", 5000),
    rules: cleanOptionalText(input.rules, "rules", 20000),
    hostName: cleanText(input.hostName || createdBy?.displayName || "Eclipse Development Studio", "hostName", {
      min: 2,
      max: 120,
    }),
    region: cleanOptionalText(input.region, "region", 80) || "Global",
    timezone: cleanOptionalText(input.timezone, "timezone", 80) || "Australia/Sydney",
    contact: cleanOptionalText(input.contact, "contact", 250),
    registrationUrl: cleanUrl(input.registrationUrl, "registrationUrl"),
    streamUrl: cleanUrl(input.streamUrl, "streamUrl"),
    startsAt,
    endsAt,
    status: cleanEnum(input.status, "status", TOURNAMENT_STATUSES, "draft"),
    registrationStatus: cleanEnum(
      input.registrationStatus,
      "registrationStatus",
      REGISTRATION_STATUSES,
      "closed",
    ),
    published: cleanBoolean(input.published, false),
    featured: cleanBoolean(input.featured, false),
    settings: defaultSettings(input.settings ?? {}),
    participants: [],
    matches: [],
    log: [],
    championId: null,
    groupStageGeneratedAt: null,
    knockoutGeneratedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    version: 1,
  };

  addLog(tournament, {
    type: "tournament_created",
    headline: `${name} was created`,
    detail: "Tournament staff are preparing the event structure.",
    recordedBy: createdBy?.displayName ?? null,
  }, { idFactory, now });
  return tournament;
}

function knockoutHasStarted(tournament) {
  return (tournament.matches ?? []).some(
    (match) => match.stage === "knockout" && !match.isBye && match.status !== "scheduled",
  );
}

function groupResultsExist(tournament) {
  return (tournament.matches ?? []).some(
    (match) => match.stage === "group" && match.status === "completed",
  );
}

function clearKnockout(tournament) {
  tournament.matches = tournament.matches.filter((match) => match.stage !== "knockout");
  tournament.knockoutGeneratedAt = null;
  tournament.championId = null;
  tournament.participants.forEach((participant) => {
    participant.advanced = false;
    participant.eliminated = false;
  });
}

export function updateTournament(current, patch, {
  actor = null,
  now = new Date().toISOString(),
} = {}) {
  const tournament = clone(current);
  const oldSettings = tournament.settings;
  const textFields = {
    name: [3, 120],
    tagline: [0, 180],
    description: [0, 5000],
    rules: [0, 20000],
    hostName: [2, 120],
    region: [0, 80],
    timezone: [0, 80],
    contact: [0, 250],
  };

  for (const [field, [min, max]] of Object.entries(textFields)) {
    if (patch[field] !== undefined) {
      tournament[field] = cleanText(patch[field], field, { min, max });
    }
  }
  if (patch.slug !== undefined) tournament.slug = normalizeTournamentSlug(patch.slug);
  if (patch.startsAt !== undefined) tournament.startsAt = cleanIsoDate(patch.startsAt, "startsAt");
  if (patch.endsAt !== undefined) tournament.endsAt = cleanIsoDate(patch.endsAt, "endsAt");
  validateTournamentDates(tournament.startsAt, tournament.endsAt);
  if (patch.registrationUrl !== undefined) {
    tournament.registrationUrl = cleanUrl(patch.registrationUrl, "registrationUrl");
  }
  if (patch.streamUrl !== undefined) tournament.streamUrl = cleanUrl(patch.streamUrl, "streamUrl");
  if (patch.status !== undefined) {
    tournament.status = cleanEnum(patch.status, "status", TOURNAMENT_STATUSES);
  }
  if (patch.registrationStatus !== undefined) {
    tournament.registrationStatus = cleanEnum(
      patch.registrationStatus,
      "registrationStatus",
      REGISTRATION_STATUSES,
    );
  }
  if (patch.published !== undefined) tournament.published = cleanBoolean(patch.published);
  if (patch.featured !== undefined) tournament.featured = cleanBoolean(patch.featured);

  if (patch.settings !== undefined) {
    const nextSettings = defaultSettings(patch.settings, tournament.settings);
    const confirmedCount = tournament.participants.filter((participant) => participant.status === "confirmed").length;
    if (nextSettings.participantCap < confirmedCount) {
      fail(409, `Participant capacity cannot be lower than the ${confirmedCount} confirmed entrants.`);
    }
    const structuralChange = nextSettings.groupCount !== oldSettings.groupCount
      || nextSettings.qualifiersPerGroup !== oldSettings.qualifiersPerGroup;
    if (structuralChange && knockoutHasStarted(tournament)) {
      fail(409, "Group or qualification settings cannot change after the knockout stage has started.");
    }
    if (nextSettings.groupCount !== oldSettings.groupCount && groupResultsExist(tournament)) {
      fail(409, "The number of groups cannot change after group results have been recorded.");
    }
    tournament.settings = nextSettings;
    if (structuralChange) clearKnockout(tournament);
    if (nextSettings.groupCount !== oldSettings.groupCount) {
      const validGroups = new Set(Array.from({ length: nextSettings.groupCount }, (_, index) => groupId(index)));
      tournament.participants.forEach((participant) => {
        if (participant.groupId && !validGroups.has(participant.groupId)) participant.groupId = null;
      });
      tournament.matches = tournament.matches.filter((match) => match.stage !== "group");
      tournament.groupStageGeneratedAt = null;
    }
  }
  return touch(tournament, actor, now);
}

export function groupId(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return `group-${label.toLowerCase()}`;
}

export function groupLabel(id) {
  return id ? `Group ${id.replace(/^group-/, "").toUpperCase()}` : "Unassigned";
}

function ensureGroupId(tournament, value, { allowNull = true } = {}) {
  if ((value === null || value === "") && allowNull) return null;
  const valid = Array.from({ length: tournament.settings.groupCount }, (_, index) => groupId(index));
  if (!valid.includes(value)) fail(400, "groupId is invalid for this tournament.");
  return value;
}

function participantById(tournament, participantId) {
  const participant = tournament.participants.find((item) => item.id === participantId);
  if (!participant) fail(404, "Participant not found.");
  return participant;
}

function normalizeParticipant(input, { idFactory }) {
  return {
    id: idFactory(),
    displayName: cleanText(input.displayName, "displayName", { min: 1, max: 80 }),
    robloxUsername: cleanOptionalText(input.robloxUsername, "robloxUsername", 40),
    seed: input.seed === undefined || input.seed === null || input.seed === ""
      ? null
      : cleanInteger(input.seed, "seed", { min: 1, max: MAX_PARTICIPANTS }),
    status: cleanEnum(input.status, "participant status", PARTICIPANT_STATUSES, "confirmed"),
    groupId: null,
    pointsAdjustment: 0,
    advanced: false,
    eliminated: false,
    checkedIn: false,
  };
}

export function addParticipants(current, inputs, {
  actor = null,
  idFactory = () => crypto.randomUUID(),
  now = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0) fail(400, "At least one participant is required.");
  if (inputs.length > 100) fail(400, "Add no more than 100 participants at once.");
  const tournament = clone(current);
  if (knockoutHasStarted(tournament)) fail(409, "Participants cannot be added after knockouts begin.");
  const additions = inputs.map((input) => normalizeParticipant(input, { idFactory }));
  if (groupResultsExist(tournament) && additions.some((participant) => participant.status === "confirmed")) {
    fail(409, "Confirmed participants cannot be added after group results have been recorded. Add them to the waitlist instead.");
  }
  const names = new Set(tournament.participants.map((participant) => participant.displayName.toLowerCase()));
  for (const participant of additions) {
    if (names.has(participant.displayName.toLowerCase())) {
      fail(409, `A participant named ${participant.displayName} already exists.`);
    }
    names.add(participant.displayName.toLowerCase());
  }
  const confirmedCount = [...tournament.participants, ...additions]
    .filter((participant) => participant.status === "confirmed").length;
  if (confirmedCount > tournament.settings.participantCap) {
    fail(409, `This would exceed the ${tournament.settings.participantCap}-participant capacity.`);
  }
  tournament.participants.push(...additions);
  if (!groupResultsExist(tournament)) {
    tournament.matches = tournament.matches.filter((match) => match.stage !== "group");
    tournament.groupStageGeneratedAt = null;
    clearKnockout(tournament);
  }
  return touch(tournament, actor, now);
}

function ensureParticipantCanChangeStructure(tournament, participantId) {
  if (groupResultsExist(tournament)) {
    fail(409, "Entrant status and group assignments are locked after group results have been recorded.");
  }
  const completed = tournament.matches.some(
    (match) => match.status === "completed"
      && (match.participantAId === participantId || match.participantBId === participantId),
  );
  if (completed) fail(409, "This participant has completed matches. Reset those results before changing their group or status.");
  if (knockoutHasStarted(tournament)) fail(409, "Participant structure is locked after knockouts begin.");
}

export function updateParticipant(current, participantId, patch, {
  actor = null,
  now = new Date().toISOString(),
} = {}) {
  const tournament = clone(current);
  const participant = participantById(tournament, participantId);
  const requestedStatus = patch.status === undefined ? participant.status : patch.status;
  const structural = patch.groupId !== undefined
    || (patch.status !== undefined && (participant.status === "confirmed" || requestedStatus === "confirmed"));
  if (structural) ensureParticipantCanChangeStructure(tournament, participantId);
  if (patch.displayName !== undefined) {
    const displayName = cleanText(patch.displayName, "displayName", { min: 1, max: 80 });
    if (tournament.participants.some(
      (item) => item.id !== participantId && item.displayName.toLowerCase() === displayName.toLowerCase(),
    )) fail(409, `A participant named ${displayName} already exists.`);
    participant.displayName = displayName;
  }
  if (patch.robloxUsername !== undefined) {
    participant.robloxUsername = cleanOptionalText(patch.robloxUsername, "robloxUsername", 40);
  }
  if (patch.seed !== undefined) {
    participant.seed = patch.seed === null || patch.seed === ""
      ? null
      : cleanInteger(patch.seed, "seed", { min: 1, max: MAX_PARTICIPANTS });
  }
  if (patch.status !== undefined) {
    participant.status = cleanEnum(patch.status, "participant status", PARTICIPANT_STATUSES);
    if (participant.status !== "confirmed") participant.groupId = null;
  }
  if (patch.groupId !== undefined) {
    if (participant.status !== "confirmed" && patch.groupId) {
      fail(409, "Only confirmed participants can be assigned to a group.");
    }
    participant.groupId = ensureGroupId(tournament, patch.groupId);
  }
  if (patch.checkedIn !== undefined) participant.checkedIn = cleanBoolean(patch.checkedIn);
  const confirmedCount = tournament.participants.filter((item) => item.status === "confirmed").length;
  if (confirmedCount > tournament.settings.participantCap) fail(409, "Tournament capacity has been reached.");
  if (structural) {
    tournament.matches = tournament.matches.filter((match) => match.stage !== "group");
    tournament.groupStageGeneratedAt = null;
    clearKnockout(tournament);
  }
  return touch(tournament, actor, now);
}

export function removeParticipant(current, participantId, {
  actor = null,
  now = new Date().toISOString(),
} = {}) {
  const tournament = clone(current);
  const participant = participantById(tournament, participantId);
  const hasMatch = tournament.matches.some(
    (match) => match.participantAId === participantId || match.participantBId === participantId,
  );
  const affectsStructure = participant.status === "confirmed" || hasMatch;
  if (affectsStructure) ensureParticipantCanChangeStructure(tournament, participantId);
  tournament.participants = tournament.participants.filter((item) => item.id !== participantId);
  if (affectsStructure) {
    tournament.matches = tournament.matches.filter(
      (match) => match.participantAId !== participantId && match.participantBId !== participantId,
    );
    tournament.groupStageGeneratedAt = null;
    clearKnockout(tournament);
  }
  return touch(tournament, actor, now);
}

function seededParticipants(tournament, random) {
  const participants = tournament.participants.filter((participant) => participant.status === "confirmed");
  if (tournament.settings.seedingMode === "balanced") {
    return participants.sort((left, right) => (left.seed ?? 9999) - (right.seed ?? 9999));
  }
  if (tournament.settings.seedingMode === "manual") {
    return participants.sort((left, right) => (left.seed ?? 9999) - (right.seed ?? 9999));
  }
  for (let index = participants.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [participants[index], participants[target]] = [participants[target], participants[index]];
  }
  return participants;
}

export function randomizeGroups(current, {
  actor = null,
  now = new Date().toISOString(),
  random = Math.random,
} = {}) {
  const tournament = clone(current);
  if (groupResultsExist(tournament)) fail(409, "Groups cannot be randomized after results have been recorded.");
  if (knockoutHasStarted(tournament)) fail(409, "Groups cannot be randomized after knockouts begin.");
  const participants = seededParticipants(tournament, random);
  if (participants.length < 2) fail(409, "Add at least two confirmed participants before assigning groups.");
  participants.forEach((participant, index) => {
    const groupIndex = tournament.settings.seedingMode === "balanced"
      ? Math.floor(index / tournament.settings.groupCount) % 2 === 0
        ? index % tournament.settings.groupCount
        : tournament.settings.groupCount - 1 - (index % tournament.settings.groupCount)
      : index % tournament.settings.groupCount;
    participant.groupId = groupId(groupIndex);
  });
  tournament.participants
    .filter((participant) => participant.status !== "confirmed")
    .forEach((participant) => { participant.groupId = null; });
  tournament.matches = tournament.matches.filter((match) => match.stage !== "group");
  tournament.groupStageGeneratedAt = null;
  clearKnockout(tournament);
  return touch(tournament, actor, now);
}

function roundRobinRounds(participantIds) {
  const rotation = [...participantIds];
  if (rotation.length % 2 === 1) rotation.push(null);
  if (rotation.length < 2) return [];
  const rounds = [];
  for (let round = 0; round < rotation.length - 1; round += 1) {
    const pairings = [];
    for (let index = 0; index < rotation.length / 2; index += 1) {
      const left = rotation[index];
      const right = rotation[rotation.length - 1 - index];
      if (left && right) pairings.push(round % 2 === 0 ? [left, right] : [right, left]);
    }
    rounds.push(pairings);
    rotation.splice(1, 0, rotation.pop());
  }
  return rounds;
}

export function generateGroupSchedule(current, {
  actor = null,
  idFactory = () => crypto.randomUUID(),
  now = new Date().toISOString(),
} = {}) {
  const tournament = clone(current);
  if (groupResultsExist(tournament)) fail(409, "The group schedule cannot be regenerated after results are recorded.");
  if (knockoutHasStarted(tournament)) fail(409, "The group schedule is locked after knockouts begin.");
  const confirmed = tournament.participants.filter((participant) => participant.status === "confirmed");
  if (confirmed.length < 2) fail(409, "Add at least two confirmed participants first.");
  if (confirmed.some((participant) => !participant.groupId)) {
    fail(409, "Every confirmed participant must be assigned to a group first.");
  }
  const expectedMatches = Array.from({ length: tournament.settings.groupCount }, (_, groupIndex) => {
    const id = groupId(groupIndex);
    const size = confirmed.filter((participant) => participant.groupId === id).length;
    return size * Math.max(0, size - 1) / 2;
  }).reduce((total, count) => total + count, 0);
  if (expectedMatches > MAX_GENERATED_GROUP_MATCHES) {
    fail(
      409,
      `This layout would create ${expectedMatches} group matches. Increase the number of groups to keep the schedule below ${MAX_GENERATED_GROUP_MATCHES} matches.`,
    );
  }
  tournament.matches = tournament.matches.filter((match) => match.stage !== "group");
  clearKnockout(tournament);
  for (let groupIndex = 0; groupIndex < tournament.settings.groupCount; groupIndex += 1) {
    const id = groupId(groupIndex);
    const groupParticipants = confirmed.filter((participant) => participant.groupId === id);
    const rounds = roundRobinRounds(groupParticipants.map((participant) => participant.id));
    rounds.forEach((pairings, roundIndex) => {
      pairings.forEach(([participantAId, participantBId], matchIndex) => {
        tournament.matches.push({
          id: idFactory(),
          stage: "group",
          groupId: id,
          round: roundIndex + 1,
          bracketPosition: matchIndex + 1,
          label: `${groupLabel(id)} · Round ${roundIndex + 1}`,
          participantAId,
          participantBId,
          scoreA: null,
          scoreB: null,
          winnerId: null,
          status: "scheduled",
          bestOf: tournament.settings.groupBestOf,
          scheduledAt: null,
          completedAt: null,
          notes: "",
          isBye: false,
          sourceMatchAId: null,
          sourceMatchBId: null,
        });
      });
    });
  }
  tournament.groupStageGeneratedAt = now;
  addLog(tournament, {
    type: "schedule_generated",
    headline: "Group stage schedule published",
    detail: `${tournament.matches.filter((match) => match.stage === "group").length} matches are ready.`,
    stage: "group",
    recordedBy: actorSnapshot(actor)?.displayName ?? null,
  }, { idFactory, now });
  return touch(tournament, actor, now);
}

function directHeadToHead(tournament, leftId, rightId) {
  const matches = tournament.matches.filter(
    (match) => match.stage === "group"
      && match.status === "completed"
      && [match.participantAId, match.participantBId].includes(leftId)
      && [match.participantAId, match.participantBId].includes(rightId),
  );
  let left = 0;
  let right = 0;
  for (const match of matches) {
    if (match.winnerId === leftId) left += 1;
    if (match.winnerId === rightId) right += 1;
  }
  return right - left;
}

export function buildStandings(tournament) {
  const participantMap = new Map(tournament.participants.map((participant) => [participant.id, participant]));
  const result = [];
  for (let groupIndex = 0; groupIndex < tournament.settings.groupCount; groupIndex += 1) {
    const id = groupId(groupIndex);
    const participants = tournament.participants.filter(
      (participant) => participant.status === "confirmed" && participant.groupId === id,
    );
    const rows = participants.map((participant) => ({
      participantId: participant.id,
      displayName: participant.displayName,
      robloxUsername: participant.robloxUsername,
      seed: participant.seed,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      scoreFor: 0,
      scoreAgainst: 0,
      scoreDifference: 0,
      pointsAdjustment: participant.pointsAdjustment ?? 0,
      points: participant.pointsAdjustment ?? 0,
      rank: 0,
      qualified: false,
    }));
    const rowMap = new Map(rows.map((row) => [row.participantId, row]));
    const matches = tournament.matches.filter((match) => match.stage === "group" && match.groupId === id);
    for (const match of matches.filter((item) => item.status === "completed")) {
      const left = rowMap.get(match.participantAId);
      const right = rowMap.get(match.participantBId);
      if (!left || !right) continue;
      left.played += 1;
      right.played += 1;
      left.scoreFor += match.scoreA;
      left.scoreAgainst += match.scoreB;
      right.scoreFor += match.scoreB;
      right.scoreAgainst += match.scoreA;
      if (match.scoreA === match.scoreB) {
        left.draws += 1;
        right.draws += 1;
        left.points += tournament.settings.pointsDraw;
        right.points += tournament.settings.pointsDraw;
      } else if (match.scoreA > match.scoreB) {
        left.wins += 1;
        right.losses += 1;
        left.points += tournament.settings.pointsWin;
        right.points += tournament.settings.pointsLoss;
      } else {
        right.wins += 1;
        left.losses += 1;
        right.points += tournament.settings.pointsWin;
        left.points += tournament.settings.pointsLoss;
      }
    }
    rows.forEach((row) => { row.scoreDifference = row.scoreFor - row.scoreAgainst; });
    rows.sort((left, right) => (
      right.points - left.points
      || right.scoreDifference - left.scoreDifference
      || right.scoreFor - left.scoreFor
      || right.wins - left.wins
      || directHeadToHead(tournament, left.participantId, right.participantId)
      || (left.seed ?? 9999) - (right.seed ?? 9999)
      || left.displayName.localeCompare(right.displayName)
    ));
    rows.forEach((row, index) => {
      row.rank = index + 1;
      row.qualified = index < tournament.settings.qualifiersPerGroup;
    });
    const expectedMatches = participants.length * Math.max(0, participants.length - 1) / 2;
    const completedMatches = matches.filter((match) => match.status === "completed").length;
    result.push({
      id,
      label: groupLabel(id),
      rows,
      totalMatches: matches.length,
      expectedMatches,
      completedMatches,
      matchesComplete: expectedMatches > 0
        && matches.length === expectedMatches
        && completedMatches === expectedMatches,
    });
  }
  return result;
}

export function groupStageComplete(tournament) {
  const standings = buildStandings(tournament).filter((group) => group.rows.length > 0);
  return standings.length > 0 && standings.every((group) => group.matchesComplete);
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function knockoutRoundLabel(round, totalRounds, bracketSize) {
  const remaining = bracketSize / 2 ** (round - 1);
  if (round === totalRounds) return "Final";
  if (round === totalRounds - 1) return "Semifinal";
  if (round === totalRounds - 2) return "Quarterfinal";
  return `Round of ${remaining}`;
}

function participantName(tournament, id) {
  return tournament.participants.find((participant) => participant.id === id)?.displayName ?? "TBD";
}

function propagateWinner(tournament, match) {
  const next = tournament.matches.find(
    (candidate) => candidate.stage === "knockout"
      && !candidate.isThirdPlace
      && (candidate.sourceMatchAId === match.id || candidate.sourceMatchBId === match.id),
  );
  if (!next) return;
  if (next.sourceMatchAId === match.id) next.participantAId = match.winnerId;
  if (next.sourceMatchBId === match.id) next.participantBId = match.winnerId;
}

function propagateSemifinalLoser(tournament, match) {
  const thirdPlace = tournament.matches.find(
    (candidate) => candidate.stage === "knockout" && candidate.isThirdPlace,
  );
  if (!thirdPlace) return;
  const loserId = match.participantAId === match.winnerId ? match.participantBId : match.participantAId;
  if (thirdPlace.sourceMatchAId === match.id) thirdPlace.participantAId = loserId;
  if (thirdPlace.sourceMatchBId === match.id) thirdPlace.participantBId = loserId;
}

export function generateKnockout(current, {
  actor = null,
  idFactory = () => crypto.randomUUID(),
  now = new Date().toISOString(),
} = {}) {
  const tournament = clone(current);
  if (!groupStageComplete(tournament)) fail(409, "Complete every generated group-stage match first.");
  if (knockoutHasStarted(tournament)) fail(409, "The knockout bracket has already started.");
  clearKnockout(tournament);
  const standings = buildStandings(tournament).filter((group) => group.rows.length > 0);
  const qualified = [];
  for (let rank = 0; rank < tournament.settings.qualifiersPerGroup; rank += 1) {
    for (const group of standings) {
      const row = group.rows[rank];
      if (row) qualified.push(row.participantId);
    }
  }
  if (qualified.length < 2) fail(409, "At least two participants must qualify for knockouts.");
  const bracketSize = nextPowerOfTwo(qualified.length);
  const totalRounds = Math.log2(bracketSize);
  const roundMatches = [];
  for (let round = 1; round <= totalRounds; round += 1) {
    const count = bracketSize / 2 ** round;
    const matches = [];
    for (let position = 1; position <= count; position += 1) {
      const previous = roundMatches[round - 2];
      matches.push({
        id: idFactory(),
        stage: "knockout",
        groupId: null,
        round,
        bracketPosition: position,
        label: knockoutRoundLabel(round, totalRounds, bracketSize),
        participantAId: null,
        participantBId: null,
        scoreA: null,
        scoreB: null,
        winnerId: null,
        status: "scheduled",
        bestOf: tournament.settings.knockoutBestOf,
        scheduledAt: null,
        completedAt: null,
        notes: "",
        isBye: false,
        isThirdPlace: false,
        sourceMatchAId: previous?.[(position - 1) * 2]?.id ?? null,
        sourceMatchBId: previous?.[(position - 1) * 2 + 1]?.id ?? null,
      });
    }
    roundMatches.push(matches);
  }
  const padded = [...qualified, ...Array(bracketSize - qualified.length).fill(null)];
  roundMatches[0].forEach((match, index) => {
    match.participantAId = padded[index];
    match.participantBId = padded[bracketSize - 1 - index];
    if (Boolean(match.participantAId) !== Boolean(match.participantBId)) {
      match.isBye = true;
      match.status = "completed";
      match.winnerId = match.participantAId ?? match.participantBId;
      match.completedAt = now;
    }
  });
  tournament.matches.push(...roundMatches.flat());
  for (const match of roundMatches[0].filter((item) => item.isBye)) propagateWinner(tournament, match);
  if (tournament.settings.thirdPlaceMatch && totalRounds >= 2) {
    const semifinals = roundMatches[totalRounds - 2];
    tournament.matches.push({
      id: idFactory(),
      stage: "knockout",
      groupId: null,
      round: totalRounds,
      bracketPosition: 2,
      label: "Third place",
      participantAId: null,
      participantBId: null,
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: "scheduled",
      bestOf: tournament.settings.knockoutBestOf,
      scheduledAt: null,
      completedAt: null,
      notes: "",
      isBye: false,
      isThirdPlace: true,
      sourceMatchAId: semifinals[0]?.id ?? null,
      sourceMatchBId: semifinals[1]?.id ?? null,
    });
  }
  tournament.participants.forEach((participant) => {
    participant.advanced = qualified.includes(participant.id);
  });
  tournament.knockoutGeneratedAt = now;
  addLog(tournament, {
    type: "advancement",
    headline: `${qualified.length} participants advanced to knockouts`,
    detail: qualified.map((id) => participantName(tournament, id)).join(", "),
    stage: "knockout",
    participantIds: qualified,
    recordedBy: actorSnapshot(actor)?.displayName ?? null,
  }, { idFactory, now });
  return touch(tournament, actor, now);
}

function downstreamMatches(tournament, matchId) {
  return tournament.matches.filter(
    (match) => match.stage === "knockout"
      && (match.sourceMatchAId === matchId || match.sourceMatchBId === matchId),
  );
}

function ensureResultEditable(tournament, match) {
  if (match.stage === "group" && knockoutHasStarted(tournament)) {
    fail(409, "Group results are locked because the knockout stage has started.");
  }
  if (match.stage === "knockout") {
    const downstream = downstreamMatches(tournament, match.id);
    if (downstream.some((item) => item.status !== "scheduled")) {
      fail(409, "This result is locked because the next knockout match has started.");
    }
  }
}

function resetDownstreamSlot(tournament, match) {
  for (const downstream of downstreamMatches(tournament, match.id)) {
    if (downstream.sourceMatchAId === match.id) downstream.participantAId = null;
    if (downstream.sourceMatchBId === match.id) downstream.participantBId = null;
    downstream.scoreA = null;
    downstream.scoreB = null;
    downstream.winnerId = null;
    downstream.completedAt = null;
    downstream.status = "scheduled";
  }
}

export function updateMatch(current, matchId, patch, {
  actor = null,
  idFactory = () => crypto.randomUUID(),
  now = new Date().toISOString(),
} = {}) {
  let tournament = clone(current);
  let match = tournament.matches.find((item) => item.id === matchId);
  if (!match) fail(404, "Match not found.");
  if (match.isBye) fail(409, "Automatic bye matches do not need a result.");
  ensureResultEditable(tournament, match);
  const previousWinnerId = match.winnerId;
  const previousStatus = match.status;
  if (patch.scheduledAt !== undefined) {
    match.scheduledAt = patch.scheduledAt ? cleanIsoDate(patch.scheduledAt, "scheduledAt") : null;
  }
  if (patch.notes !== undefined) match.notes = cleanOptionalText(patch.notes, "notes", 1000);
  const status = cleanEnum(patch.status, "match status", MATCH_STATUSES, match.status);
  match.status = status;
  if (status === "completed") {
    if (!match.participantAId || !match.participantBId) fail(409, "Both match slots must be filled before saving a result.");
    match.scoreA = cleanInteger(patch.scoreA, "scoreA", { min: 0, max: 999 });
    match.scoreB = cleanInteger(patch.scoreB, "scoreB", { min: 0, max: 999 });
    if (match.stage === "knockout" && match.scoreA === match.scoreB) {
      fail(400, "Knockout matches cannot end in a draw.");
    }
    if (match.stage === "group" && !tournament.settings.allowDraws && match.scoreA === match.scoreB) {
      fail(400, "Draws are disabled for this tournament.");
    }
    match.winnerId = match.scoreA === match.scoreB
      ? null
      : match.scoreA > match.scoreB ? match.participantAId : match.participantBId;
    match.completedAt = now;
  } else {
    match.scoreA = null;
    match.scoreB = null;
    match.winnerId = null;
    match.completedAt = null;
  }

  if (match.stage === "knockout") {
    if (previousWinnerId && previousWinnerId !== match.winnerId) resetDownstreamSlot(tournament, match);
    if (previousWinnerId && tournament.championId === previousWinnerId && match.status !== "completed") {
      tournament.championId = null;
    }
    if (match.status === "completed") {
      propagateWinner(tournament, match);
      const totalRounds = Math.max(...tournament.matches
        .filter((item) => item.stage === "knockout" && !item.isThirdPlace)
        .map((item) => item.round));
      if (match.round === totalRounds - 1) propagateSemifinalLoser(tournament, match);
      if (match.round === totalRounds && !match.isThirdPlace) {
        tournament.championId = match.winnerId;
        if (match.winnerId) participantById(tournament, match.winnerId).eliminated = false;
      }
    }
  }

  if (match.status === "completed") {
    addLog(tournament, {
      type: "match_result",
      headline: `${participantName(tournament, match.participantAId)} ${match.scoreA}–${match.scoreB} ${participantName(tournament, match.participantBId)}`,
      detail: match.notes || `${match.label} result ${previousStatus === "completed" ? "updated" : "recorded"}.`,
      stage: match.stage,
      matchId: match.id,
      participantIds: [match.participantAId, match.participantBId],
      score: { a: match.scoreA, b: match.scoreB },
      recordedBy: actorSnapshot(actor)?.displayName ?? null,
    }, { idFactory, now });
  }

  if (match.stage === "group") {
    const complete = groupStageComplete(tournament);
    if (tournament.knockoutGeneratedAt && !knockoutHasStarted(tournament)) clearKnockout(tournament);
    if (tournament.settings.autoAdvance && complete) {
      tournament = generateKnockout(tournament, { actor, idFactory, now });
    }
  }
  return touch(tournament, actor, now);
}

export function adjustParticipantPoints(current, participantId, input, {
  actor = null,
  idFactory = () => crypto.randomUUID(),
  now = new Date().toISOString(),
} = {}) {
  let tournament = clone(current);
  if (knockoutHasStarted(tournament)) fail(409, "Standings are locked because knockouts have started.");
  const participant = participantById(tournament, participantId);
  const delta = cleanInteger(input.delta, "delta", { min: -1000, max: 1000 });
  const reason = cleanText(input.reason, "reason", { min: 3, max: 250 });
  participant.pointsAdjustment = Number(participant.pointsAdjustment ?? 0) + delta;
  addLog(tournament, {
    type: "points_adjustment",
    headline: `${participant.displayName} received ${delta >= 0 ? "+" : ""}${delta} points`,
    detail: reason,
    stage: "group",
    participantIds: [participant.id],
    recordedBy: actorSnapshot(actor)?.displayName ?? null,
  }, { idFactory, now });
  if (tournament.knockoutGeneratedAt && groupStageComplete(tournament)) {
    clearKnockout(tournament);
    tournament = generateKnockout(tournament, { actor, idFactory, now });
  }
  return touch(tournament, actor, now);
}

export function addTournamentAnnouncement(current, input, {
  actor = null,
  idFactory = () => crypto.randomUUID(),
  now = new Date().toISOString(),
} = {}) {
  const tournament = clone(current);
  const headline = cleanText(input.headline, "headline", { min: 3, max: 140 });
  const detail = cleanOptionalText(input.detail, "detail", 1000);
  addLog(tournament, {
    type: "announcement",
    headline,
    detail,
    recordedBy: actorSnapshot(actor)?.displayName ?? null,
  }, { idFactory, now });
  return touch(tournament, actor, now);
}

export function toAdminTournament(tournament) {
  const { createdBy: _createdBy, updatedBy: _updatedBy, version: _version, ...publicFields } = clone(tournament);
  const standings = buildStandings(tournament);
  const completedMatches = tournament.matches.filter((match) => match.status === "completed" && !match.isBye).length;
  return {
    ...publicFields,
    standings,
    participantCount: tournament.participants.filter((participant) => participant.status === "confirmed").length,
    completedMatches,
    totalMatches: tournament.matches.filter((match) => !match.isBye).length,
    groupStageComplete: groupStageComplete(tournament),
  };
}

export function toPublicTournament(tournament) {
  const result = toAdminTournament(tournament);
  result.participants = result.participants.filter((participant) => participant.status === "confirmed");
  return result;
}

export function toTournamentSummary(tournament) {
  const publicTournament = toPublicTournament(tournament);
  const participantMap = new Map(tournament.participants.map((participant) => [participant.id, participant]));
  const knockoutPreview = tournament.matches
    .filter((match) => match.stage === "knockout" && !match.isBye)
    .sort((left, right) => left.round - right.round || left.bracketPosition - right.bracketPosition)
    .slice(0, 4)
    .map((match) => ({
      id: match.id,
      label: match.label,
      participantA: participantMap.get(match.participantAId)?.displayName ?? "TBD",
      participantB: participantMap.get(match.participantBId)?.displayName ?? "TBD",
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      status: match.status,
    }));
  const groupPreview = publicTournament.standings
    .filter((group) => group.rows.length > 0)
    .slice(0, 2)
    .map((group) => ({
      id: group.id,
      label: group.label,
      rows: group.rows.slice(0, 3).map((row) => ({
        participantId: row.participantId,
        displayName: row.displayName,
        rank: row.rank,
        points: row.points,
      })),
    }));
  const {
    participants: _participants,
    matches: _matches,
    log: _log,
    standings: _standings,
    rules: _rules,
    description: _description,
    ...summary
  } = publicTournament;
  return {
    ...summary,
    description: tournament.description,
    previewMatches: knockoutPreview,
    previewGroups: groupPreview,
    recentResult: tournament.log.find((entry) => entry.type === "match_result") ?? null,
  };
}
