import assert from "node:assert/strict";
import test from "node:test";
import {
  addParticipants,
  adjustParticipantPoints,
  buildStandings,
  createTournament,
  generateGroupSchedule,
  generateKnockout,
  randomizeGroups,
  removeParticipant,
  toAdminTournament,
  toPublicTournament,
  updateParticipant,
  updateMatch,
  updateTournament,
} from "./tournament-domain.mjs";

function ids(prefix = "id") {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function makeTournament(settings = {}) {
  const idFactory = ids();
  const tournament = createTournament({
    name: "Eclipse Open",
    slug: "eclipse-open",
    startsAt: "2026-08-10T00:00:00.000Z",
    endsAt: "2026-08-17T00:00:00.000Z",
    hostName: "Eclipse Esports",
    settings,
  }, {
    id: "tournament-1",
    idFactory,
    now: "2026-08-03T00:00:00.000Z",
  });
  return { tournament, idFactory };
}

function completeMatch(tournament, matchId, scoreA, scoreB, idFactory) {
  return updateMatch(tournament, matchId, {
    status: "completed",
    scoreA,
    scoreB,
  }, {
    idFactory,
    now: "2026-08-11T00:00:00.000Z",
  });
}

test("builds a scalable 32-player group stage and auto-advances the top two", () => {
  const setup = makeTournament({
    participantCap: 32,
    groupCount: 8,
    qualifiersPerGroup: 2,
    autoAdvance: true,
  });
  let tournament = addParticipants(
    setup.tournament,
    Array.from({ length: 32 }, (_, index) => ({
      displayName: `Player ${String(index + 1).padStart(2, "0")}`,
      robloxUsername: `RobloxPlayer${index + 1}`,
      isr: 5000 - index * 100,
    })),
    { idFactory: setup.idFactory },
  );
  tournament = randomizeGroups(tournament, { random: () => 0.37 });
  tournament = generateGroupSchedule(tournament, { idFactory: setup.idFactory });

  assert.equal(tournament.participants.filter((participant) => participant.groupId).length, 32);
  assert.deepEqual(
    buildStandings(tournament).map((group) => group.rows.length),
    [4, 4, 4, 4, 4, 4, 4, 4],
  );
  const groupMatches = tournament.matches.filter((match) => match.stage === "group");
  assert.equal(groupMatches.length, 48);

  for (const match of groupMatches) {
    tournament = completeMatch(tournament, match.id, 2, 0, setup.idFactory);
  }

  assert.equal(tournament.participants.filter((participant) => participant.advanced).length, 16);
  assert.equal(tournament.matches.filter((match) => match.stage === "knockout").length, 15);
  assert.equal(tournament.knockoutGeneratedAt, "2026-08-11T00:00:00.000Z");
});

test("standings include saved results and transparent manual point adjustments", () => {
  const setup = makeTournament({
    participantCap: 4,
    groupCount: 1,
    qualifiersPerGroup: 2,
    autoAdvance: false,
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
  });
  let tournament = addParticipants(setup.tournament, [
    { displayName: "Atomic" },
    { displayName: "Nova" },
    { displayName: "Vanta" },
    { displayName: "Solar" },
  ], { idFactory: setup.idFactory });
  tournament = randomizeGroups(tournament, { random: () => 0.5 });
  tournament = generateGroupSchedule(tournament, { idFactory: setup.idFactory });
  const firstMatch = tournament.matches.find((match) => match.stage === "group");
  tournament = completeMatch(tournament, firstMatch.id, 3, 1, setup.idFactory);
  const losingParticipant = firstMatch.participantBId;
  tournament = adjustParticipantPoints(tournament, losingParticipant, {
    delta: 2,
    reason: "Administrative fair-play adjustment",
  }, { idFactory: setup.idFactory });

  const rows = buildStandings(tournament)[0].rows;
  const winner = rows.find((row) => row.participantId === firstMatch.participantAId);
  const loser = rows.find((row) => row.participantId === losingParticipant);
  assert.equal(winner.points, 3);
  assert.equal(loser.points, 2);
  assert.equal(loser.pointsAdjustment, 2);
  assert.match(tournament.log[0].headline, /\+2 points/);
});

test("knockout winners propagate to the final and produce a champion", () => {
  const setup = makeTournament({
    participantCap: 4,
    groupCount: 2,
    qualifiersPerGroup: 2,
    autoAdvance: false,
  });
  let tournament = addParticipants(setup.tournament, [
    { displayName: "Astra" },
    { displayName: "Blaze" },
    { displayName: "Cipher" },
    { displayName: "Drift" },
  ], { idFactory: setup.idFactory });
  tournament = randomizeGroups(tournament, { random: () => 0.25 });
  tournament = generateGroupSchedule(tournament, { idFactory: setup.idFactory });
  for (const match of tournament.matches.filter((item) => item.stage === "group")) {
    tournament = completeMatch(tournament, match.id, 2, 0, setup.idFactory);
  }
  tournament = generateKnockout(tournament, { idFactory: setup.idFactory });

  const semifinals = tournament.matches.filter((match) => match.stage === "knockout" && match.round === 1);
  assert.equal(semifinals.length, 2);
  for (const semifinal of semifinals) {
    tournament = completeMatch(tournament, semifinal.id, 3, 1, setup.idFactory);
  }
  const final = tournament.matches.find(
    (match) => match.stage === "knockout" && match.label === "Final",
  );
  assert.ok(final.participantAId);
  assert.ok(final.participantBId);
  tournament = completeMatch(tournament, final.id, 4, 2, setup.idFactory);

  assert.equal(tournament.championId, final.participantAId);
  assert.equal(tournament.log[0].type, "match_result");
  assert.match(tournament.log[0].headline, /4–2/);
});

test("non-power-of-two qualifiers receive byes without prematurely completing later rounds", () => {
  const setup = makeTournament({
    participantCap: 6,
    groupCount: 3,
    qualifiersPerGroup: 1,
    autoAdvance: false,
  });
  let tournament = addParticipants(
    setup.tournament,
    Array.from({ length: 6 }, (_, index) => ({ displayName: `Entrant ${index + 1}` })),
    { idFactory: setup.idFactory },
  );
  tournament = randomizeGroups(tournament, { random: () => 0.75 });
  tournament = generateGroupSchedule(tournament, { idFactory: setup.idFactory });
  for (const match of tournament.matches.filter((item) => item.stage === "group")) {
    tournament = completeMatch(tournament, match.id, 1, 0, setup.idFactory);
  }
  tournament = generateKnockout(tournament, { idFactory: setup.idFactory });

  const firstRound = tournament.matches.filter((match) => match.stage === "knockout" && match.round === 1);
  const final = tournament.matches.find((match) => match.stage === "knockout" && match.round === 2);
  assert.equal(firstRound.filter((match) => match.isBye).length, 1);
  assert.equal(final.status, "scheduled");
  assert.equal(Boolean(final.participantAId) || Boolean(final.participantBId), true);
});

test("staff can manually select a 16-player knockout field without removing recorded group entrants", () => {
  const setup = makeTournament({
    participantCap: 32,
    groupCount: 8,
    qualifiersPerGroup: 4,
    autoAdvance: false,
  });
  let tournament = addParticipants(
    setup.tournament,
    Array.from({ length: 32 }, (_, index) => ({ displayName: `Manual ${index + 1}` })),
    { idFactory: setup.idFactory },
  );
  tournament = randomizeGroups(tournament, { random: () => 0.4 });
  tournament = generateGroupSchedule(tournament, { idFactory: setup.idFactory });
  for (const match of tournament.matches.filter((match) => match.stage === "group")) {
    tournament = completeMatch(tournament, match.id, 2, 0, setup.idFactory);
  }
  const selectedIds = buildStandings(tournament).flatMap((group) => group.rows.slice(0, 2).map((row) => row.participantId));
  tournament = generateKnockout(tournament, { idFactory: setup.idFactory, participantIds: selectedIds });

  assert.equal(tournament.participants.length, 32);
  assert.equal(tournament.participants.filter((participant) => participant.advanced).length, 16);
  assert.equal(tournament.participants.filter((participant) => participant.eliminated).length, 16);
  assert.equal(tournament.matches.filter((match) => match.stage === "knockout" && match.round === 1).length, 8);
  assert.match(tournament.log[0].headline, /manually selected/);
});

test("projected brackets pair group winners with other-group runners-up and reveal clinched placements", () => {
  const setup = makeTournament({
    participantCap: 8,
    groupCount: 4,
    qualifiersPerGroup: 2,
    autoAdvance: false,
    seedingMode: "balanced",
  });
  let tournament = addParticipants(
    setup.tournament,
    Array.from({ length: 8 }, (_, index) => ({ displayName: `Seed ${index + 1}`, isr: 5000 - index * 100 })),
    { idFactory: setup.idFactory },
  );
  tournament = randomizeGroups(tournament, { random: () => 0.4 });
  tournament = generateGroupSchedule(tournament, { idFactory: setup.idFactory });
  for (const match of tournament.matches.filter((match) => match.stage === "group")) {
    tournament = completeMatch(tournament, match.id, 2, 0, setup.idFactory);
  }
  tournament = generateKnockout(tournament, { idFactory: setup.idFactory });
  const ranks = new Map(buildStandings(tournament).flatMap((group) => group.rows.map((row) => [row.participantId, row.rank])));
  const groups = new Map(tournament.participants.map((participant) => [participant.id, participant.groupId]));
  const openingMatches = tournament.matches.filter((match) => match.stage === "knockout" && match.round === 1);
  for (const match of openingMatches) {
    assert.notEqual(groups.get(match.participantAId), groups.get(match.participantBId));
    assert.deepEqual([ranks.get(match.participantAId), ranks.get(match.participantBId)].sort(), [1, 2]);
  }

  const previewSetup = makeTournament({ participantCap: 6, groupCount: 2, qualifiersPerGroup: 2, autoAdvance: false });
  let previewTournament = addParticipants(
    previewSetup.tournament,
    Array.from({ length: 6 }, (_, index) => ({ displayName: `Preview ${index + 1}` })),
    { idFactory: previewSetup.idFactory },
  );
  previewTournament = randomizeGroups(previewTournament, { random: () => 0.4 });
  previewTournament = generateGroupSchedule(previewTournament, { idFactory: previewSetup.idFactory });
  const leader = previewTournament.participants.find((participant) => participant.groupId === "group-a");
  for (const match of previewTournament.matches.filter(
    (match) => match.stage === "group" && (match.participantAId === leader.id || match.participantBId === leader.id),
  )) {
    previewTournament = completeMatch(
      previewTournament,
      match.id,
      match.participantAId === leader.id ? 2 : 0,
      match.participantBId === leader.id ? 2 : 0,
      previewSetup.idFactory,
    );
  }
  const publicTournament = toPublicTournament(previewTournament);
  assert.equal(previewTournament.matches.some((match) => match.stage === "knockout"), false);
  assert.equal(publicTournament.knockoutPreview.some((match) => match.participantA === leader.displayName || match.participantB === leader.displayName), true);
  assert.equal(publicTournament.knockoutPreview.some((match) => /Winner of Group B/.test(match.participantA) || /Winner of Group B/.test(match.participantB)), true);
});

test("unplayed entrants can be reassigned or removed without disturbing completed group results", () => {
  const setup = makeTournament({
    participantCap: 4,
    groupCount: 1,
    qualifiersPerGroup: 2,
    autoAdvance: false,
  });
  let tournament = addParticipants(setup.tournament, [
    { displayName: "North" },
    { displayName: "South" },
  ], { idFactory: setup.idFactory });
  tournament = randomizeGroups(tournament, { random: () => 0.2 });
  tournament = generateGroupSchedule(tournament, { idFactory: setup.idFactory });
  const completedParticipantId = tournament.matches[0].participantAId;
  tournament = completeMatch(tournament, tournament.matches[0].id, 1, 0, setup.idFactory);
  const resultMatchId = tournament.matches[0].id;
  tournament = addParticipants(tournament, [
    { displayName: "Reserve", status: "waitlist" },
  ], { idFactory: setup.idFactory });

  assert.equal(tournament.matches.find((match) => match.id === resultMatchId)?.status, "completed");
  const reserve = tournament.participants.find((participant) => participant.displayName === "Reserve");
  tournament = updateParticipant(tournament, reserve.id, { status: "confirmed", groupId: "group-a" }, { idFactory: setup.idFactory });
  assert.equal(tournament.matches.find((match) => match.id === resultMatchId)?.status, "completed");
  assert.equal(tournament.matches.filter((match) => match.stage === "group" && match.status === "scheduled").length, 2);
  assert.equal(toAdminTournament(tournament).participants.length, 3);
  assert.equal(toPublicTournament(tournament).participants.length, 3);

  tournament = removeParticipant(tournament, reserve.id, { idFactory: setup.idFactory });
  assert.equal(tournament.matches.find((match) => match.id === resultMatchId)?.status, "completed");
  assert.equal(tournament.matches.filter((match) => match.stage === "group").length, 1);
  assert.throws(() => removeParticipant(tournament, completedParticipantId), /completed matches/);
});

test("ISR defaults to 100, stays within range, and orders strongest entrants first", () => {
  const setup = makeTournament({
    participantCap: 4,
    groupCount: 2,
    qualifiersPerGroup: 1,
    seedingMode: "balanced",
  });
  let tournament = addParticipants(setup.tournament, [
    { displayName: "Elite", isr: 5000 },
    { displayName: "Expert", isr: 4000 },
    { displayName: "Rising", isr: 3000 },
    { displayName: "Newcomer" },
  ], { idFactory: setup.idFactory });
  tournament = randomizeGroups(tournament);

  const byName = new Map(tournament.participants.map((participant) => [participant.displayName, participant]));
  assert.equal(byName.get("Newcomer")?.isr, 100);
  assert.equal(byName.get("Elite")?.groupId, "group-a");
  assert.equal(byName.get("Expert")?.groupId, "group-b");
  assert.equal(byName.get("Rising")?.groupId, "group-b");
  assert.equal(byName.get("Newcomer")?.groupId, "group-a");

  const firstGroup = buildStandings(tournament)[0].rows;
  assert.deepEqual(firstGroup.map((row) => row.isr), [5000, 100]);
  assert.throws(
    () => addParticipants(setup.tournament, [{ displayName: "Too low", isr: 99 }]),
    /isr must be at least 100/,
  );
  assert.throws(
    () => updateParticipant(tournament, byName.get("Elite").id, { isr: 5001 }),
    /isr must be at most 5000/,
  );
});

test("legacy seeds migrate safely and private R2 banner keys are never serialized", () => {
  const setup = makeTournament();
  let tournament = addParticipants(
    setup.tournament,
    [{ displayName: "Legacy entrant" }],
    { idFactory: setup.idFactory },
  );
  delete tournament.participants[0].isr;
  tournament.participants[0].seed = 1;
  tournament.banner = {
    id: "banner-1",
    objectKey: "tournament-banners/private/banner.png",
    originalName: "banner.png",
    contentType: "image/png",
    size: 1024,
    uploadedAt: "2026-08-04T00:00:00.000Z",
    uploader: null,
  };
  tournament.pendingBanner = {
    id: "pending-1",
    objectKey: "tournament-banners/private/pending.png",
  };

  const serialized = toAdminTournament(tournament);
  assert.equal(serialized.participants[0].isr, 100);
  assert.equal("seed" in serialized.participants[0], false);
  assert.equal("pendingBanner" in serialized, false);
  assert.equal("objectKey" in serialized.banner, false);
  assert.equal(serialized.bannerImageUrl, null);
  assert.equal(toPublicTournament(tournament).banner.uploader, null);

  tournament = updateTournament(tournament, { tagline: "Migrated" });
  assert.equal(tournament.participants[0].isr, 100);
  assert.equal("seed" in tournament.participants[0], false);
  assert.equal(tournament.settings.tiebreakers.at(-1), "isr");
});
