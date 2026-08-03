import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  addTournamentAnnouncement,
  addTournamentParticipants,
  adjustTournamentPoints,
  createTournament,
  generateTournamentGroupSchedule,
  generateTournamentKnockout,
  loadAdminTournament,
  loadAdminTournaments,
  loadTournamentBannerPolicy,
  randomizeTournamentGroups,
  deleteTournamentBanner,
  removeTournamentParticipant,
  updateTournament,
  updateTournamentMatch,
  updateTournamentParticipant,
  uploadTournamentBanner,
  type TournamentInput,
} from "../api";
import { attachmentAccept, formatFileSize, mergeSelectedFiles } from "../attachments";
import { useAuth } from "../AuthContext";
import {
  RegistrationBadge,
  TournamentBattleLog,
  TournamentBracket,
  TournamentPreview,
  TournamentStandings,
  TournamentStatusBadge,
  formatTournamentDateRange,
} from "../Components/TournamentUI";
import { ESPORTS_CONTENT } from "../content/esportsContent";
import { Link, useNavigate, useParams } from "../router";
import type {
  AttachmentPolicy,
  Tournament,
  TournamentMatch,
  TournamentParticipant,
  TournamentParticipantStatus,
  TournamentSummary,
} from "../types";
import "./Esports.css";

type ManagerTab = "setup" | "entrants" | "groups" | "knockout" | "log";

function isoFromLocal(value: string) {
  return value ? new Date(value).toISOString() : "";
}

function localFromIso(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function groupCode(index: number) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function defaultTournamentInput(): TournamentInput {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  start.setMinutes(0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return {
    name: "",
    slug: "",
    tagline: "OFFICIAL TOWER ECLIPSE EVENT",
    description: "",
    rules: "",
    hostName: "Eclipse Development Studio",
    region: "Global",
    timezone: "Australia/Sydney",
    contact: "",
    registrationUrl: "",
    streamUrl: "",
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    status: "draft",
    registrationStatus: "closed",
    published: false,
    featured: false,
    settings: {
      participantCap: 32,
      groupCount: 8,
      qualifiersPerGroup: 2,
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      allowDraws: true,
      autoAdvance: true,
      groupBestOf: 1,
      knockoutBestOf: 3,
      thirdPlaceMatch: false,
      checkInRequired: false,
      seedingMode: "random",
      tiebreakers: ["points", "scoreDifference", "scoreFor", "wins", "headToHead", "isr"],
    },
  };
}

function inputFromTournament(tournament: Tournament): TournamentInput {
  return {
    name: tournament.name,
    slug: tournament.slug,
    tagline: tournament.tagline,
    description: tournament.description,
    rules: tournament.rules,
    hostName: tournament.hostName,
    region: tournament.region,
    timezone: tournament.timezone,
    contact: tournament.contact,
    registrationUrl: tournament.registrationUrl,
    streamUrl: tournament.streamUrl,
    startsAt: tournament.startsAt,
    endsAt: tournament.endsAt,
    status: tournament.status,
    registrationStatus: tournament.registrationStatus,
    published: tournament.published,
    featured: tournament.featured,
    settings: { ...tournament.settings },
  };
}

function ManagerDashboard() {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAdminTournaments()
      .then(setTournaments)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load tournaments."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="esports-page tournament-manager-page">
      <div className="manager-header">
        <div>
          <p className="esports-eyebrow">DEVELOPER CONTROL ROOM</p>
          <h2>TOURNAMENT MANAGER</h2>
          <p>{ESPORTS_CONTENT.managerDescription}</p>
        </div>
        <Link to="/esports/manage/new" className="esports-primary-button">+ NEW TOURNAMENT</Link>
      </div>
      {error && <div className="tournament-message tournament-message-error">{error}</div>}
      {loading ? <div className="tournament-loading"><span /><span /><span /></div> : (
        <div className="manager-tournament-list">
          {tournaments.length === 0 && (
            <div className="manager-empty">
              <h3>CREATE YOUR FIRST TOURNAMENT</h3>
              <p>Start with the event format, then add entrants and let the manager build the stages.</p>
              <Link to="/esports/manage/new" className="esports-primary-button">GET STARTED</Link>
            </div>
          )}
          {tournaments.map((tournament) => (
            <article className="manager-tournament-card" key={tournament.id}>
              <div className="manager-card-preview">
                {tournament.bannerImageUrl ? (
                  <img className="tournament-card-banner" src={tournament.bannerImageUrl} alt="" />
                ) : (
                  <TournamentPreview tournament={tournament} />
                )}
              </div>
              <div className="manager-card-copy">
                <div className="manager-card-badges">
                  <TournamentStatusBadge status={tournament.status} />
                  <RegistrationBadge status={tournament.registrationStatus} />
                  <span className={tournament.published ? "published-state" : "draft-state"}>
                    {tournament.published ? "PUBLIC" : "HIDDEN"}
                  </span>
                </div>
                <h3>{tournament.name}</h3>
                <p>{formatTournamentDateRange(tournament.startsAt, tournament.endsAt)} · {tournament.participantCount}/{tournament.settings.participantCap} entrants</p>
                <div>
                  <Link to={`/esports/manage/${encodeURIComponent(tournament.id)}`} className="esports-primary-button">MANAGE</Link>
                  {tournament.published && <Link to={`/esports/${encodeURIComponent(tournament.slug)}`} className="esports-secondary-button">VIEW PUBLIC PAGE</Link>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ParticipantEditor({
  participant,
  groupCount,
  checkInRequired,
  disabled,
  onSave,
  onRemove,
}: {
  participant: TournamentParticipant;
  groupCount: number;
  checkInRequired: boolean;
  disabled: boolean;
  onSave: (changes: Partial<TournamentParticipant>) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(participant.displayName);
  const [robloxUsername, setRobloxUsername] = useState(participant.robloxUsername);
  const [isr, setIsr] = useState(participant.isr.toString());
  const [status, setStatus] = useState<TournamentParticipantStatus>(participant.status);
  const [groupId, setGroupId] = useState(participant.groupId ?? "");
  const [checkedIn, setCheckedIn] = useState(participant.checkedIn);

  useEffect(() => {
    setDisplayName(participant.displayName);
    setRobloxUsername(participant.robloxUsername);
    setIsr(participant.isr.toString());
    setStatus(participant.status);
    setGroupId(participant.groupId ?? "");
    setCheckedIn(participant.checkedIn);
  }, [participant]);

  return (
    <div className="participant-editor-row">
      <label><span>Display name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label><span>Roblox username</span><input value={robloxUsername} onChange={(event) => setRobloxUsername(event.target.value)} /></label>
      <label><span>ISR</span><input type="number" min="100" max="5000" required value={isr} onChange={(event) => setIsr(event.target.value)} /></label>
      <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as TournamentParticipantStatus)}>
        <option value="confirmed">Confirmed</option><option value="waitlist">Waitlist</option><option value="withdrawn">Withdrawn</option>
      </select></label>
      <label><span>Group</span><select value={groupId} onChange={(event) => setGroupId(event.target.value)} disabled={status !== "confirmed"}>
        <option value="">Unassigned</option>
        {Array.from({ length: groupCount }, (_, index) => {
          const label = groupCode(index);
          return <option value={`group-${label.toLowerCase()}`} key={label}>Group {label}</option>;
        })}
      </select></label>
      {checkInRequired && <label className="participant-check"><span>Check-in</span><input type="checkbox" checked={checkedIn} onChange={(event) => setCheckedIn(event.target.checked)} /></label>}
      <div className="participant-row-actions">
        <button
          type="button"
          disabled={disabled || !displayName.trim()}
          onClick={() => {
            void onSave({
              displayName,
              robloxUsername,
              isr: isr ? Number(isr) : 100,
              status,
              groupId: status === "confirmed" ? groupId || null : null,
              checkedIn,
            }).catch(() => undefined);
          }}
        >SAVE</button>
        <button className="danger" type="button" disabled={disabled} onClick={() => { void onRemove().catch(() => undefined); }}>REMOVE</button>
      </div>
    </div>
  );
}

function MatchEditor({
  match,
  participants,
  disabled,
  onSave,
}: {
  match: TournamentMatch;
  participants: TournamentParticipant[];
  disabled: boolean;
  onSave: (input: Parameters<typeof updateTournamentMatch>[2]) => Promise<void>;
}) {
  const [status, setStatus] = useState(match.status);
  const [scoreA, setScoreA] = useState(match.scoreA?.toString() ?? "");
  const [scoreB, setScoreB] = useState(match.scoreB?.toString() ?? "");
  const [scheduledAt, setScheduledAt] = useState(localFromIso(match.scheduledAt));
  const [notes, setNotes] = useState(match.notes);
  const names = new Map(participants.map((participant) => [participant.id, participant.displayName]));

  useEffect(() => {
    setStatus(match.status);
    setScoreA(match.scoreA?.toString() ?? "");
    setScoreB(match.scoreB?.toString() ?? "");
    setScheduledAt(localFromIso(match.scheduledAt));
    setNotes(match.notes);
  }, [match]);

  return (
    <article className={`manager-match-card manager-match-${match.status}`}>
      <header><span>{match.label}</span><b>{match.isBye ? "AUTOMATIC BYE" : `BEST OF ${match.bestOf}`}</b></header>
      <div className="manager-match-versus">
        <strong>{match.participantAId ? names.get(match.participantAId) ?? "Unknown" : "TBD"}</strong>
        <input aria-label="First participant score" type="number" min="0" max="999" value={scoreA} onChange={(event) => setScoreA(event.target.value)} disabled={match.isBye} />
        <span>—</span>
        <input aria-label="Second participant score" type="number" min="0" max="999" value={scoreB} onChange={(event) => setScoreB(event.target.value)} disabled={match.isBye} />
        <strong>{match.participantBId ? names.get(match.participantBId) ?? "Unknown" : "TBD"}</strong>
      </div>
      {!match.isBye && (
        <div className="manager-match-controls">
          <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as TournamentMatch["status"])}>
            <option value="scheduled">Scheduled</option><option value="live">Live</option><option value="completed">Completed</option>
          </select></label>
          <label><span>Match time</span><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
          <label className="match-notes-field"><span>Public result note</span><input value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} placeholder="Optional context for the battle log" /></label>
          <button
            type="button"
            disabled={disabled || (status === "completed" && (scoreA === "" || scoreB === ""))}
            onClick={() => {
              void onSave({
                status,
                scoreA: scoreA === "" ? null : Number(scoreA),
                scoreB: scoreB === "" ? null : Number(scoreB),
                scheduledAt: scheduledAt ? isoFromLocal(scheduledAt) : null,
                notes,
              }).catch(() => undefined);
            }}
          >SAVE MATCH</button>
        </div>
      )}
    </article>
  );
}

function TournamentEditor({ tournamentId }: { tournamentId: string }) {
  const isNew = tournamentId === "new";
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [draft, setDraft] = useState<TournamentInput>(() => defaultTournamentInput());
  const [tab, setTab] = useState<ManagerTab>("setup");
  const [loading, setLoading] = useState(!isNew);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkEntrants, setBulkEntrants] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [adjustParticipantId, setAdjustParticipantId] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("0");
  const [adjustReason, setAdjustReason] = useState("");
  const [announcementHeadline, setAnnouncementHeadline] = useState("");
  const [announcementDetail, setAnnouncementDetail] = useState("");
  const [bannerPolicy, setBannerPolicy] = useState<AttachmentPolicy | null>(null);
  const [selectedBanner, setSelectedBanner] = useState<File | null>(null);

  const selectedBannerPreview = useMemo(
    () => selectedBanner ? URL.createObjectURL(selectedBanner) : null,
    [selectedBanner],
  );

  useEffect(() => () => {
    if (selectedBannerPreview) URL.revokeObjectURL(selectedBannerPreview);
  }, [selectedBannerPreview]);

  useEffect(() => {
    if (isNew) return;
    loadTournamentBannerPolicy()
      .then(setBannerPolicy)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load banner upload settings."));
  }, [isNew]);

  useEffect(() => {
    if (isNew) return;
    loadAdminTournament(tournamentId)
      .then((result) => {
        setTournament(result);
        setDraft(inputFromTournament(result));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load tournament."))
      .finally(() => setLoading(false));
  }, [isNew, tournamentId]);

  function updateField<K extends keyof TournamentInput>(field: K, value: TournamentInput[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateSetting<K extends keyof TournamentInput["settings"]>(field: K, value: TournamentInput["settings"][K]) {
    setDraft((current) => ({ ...current, settings: { ...current.settings, [field]: value } }));
  }

  async function runAction(label: string, action: () => Promise<Tournament>, success: string) {
    setWorking(label);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      setTournament(result);
      setNotice(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The tournament could not be updated.");
      throw reason;
    } finally {
      setWorking(null);
    }
  }

  async function saveSetup(event: FormEvent) {
    event.preventDefault();
    if (!auth) return;
    setWorking("setup");
    setError(null);
    setNotice(null);
    try {
      if (isNew) {
        const created = await createTournament(draft, auth.csrfToken);
        navigate(`/esports/manage/${encodeURIComponent(created.id)}`, { replace: true });
      } else {
        const updated = await updateTournament(tournamentId, draft, auth.csrfToken);
        setTournament(updated);
        setDraft(inputFromTournament(updated));
        setNotice("Tournament configuration saved.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save tournament settings.");
    } finally {
      setWorking(null);
    }
  }

  if (loading) {
    return <section className="esports-page tournament-manager-page"><div className="tournament-loading"><span /><span /><span /></div></section>;
  }
  if (!isNew && !tournament) {
    return <section className="esports-page tournament-not-found"><h2>TOURNAMENT UNAVAILABLE</h2><p>{error}</p><Link to="/esports/manage" className="esports-primary-button">BACK TO CONTROL ROOM</Link></section>;
  }

  const confirmedParticipants = tournament?.participants.filter((participant) => participant.status === "confirmed") ?? [];
  const groupMatches = tournament?.matches.filter(
    (match) => match.stage === "group" && (selectedGroup === "all" || match.groupId === selectedGroup),
  ) ?? [];
  const knockoutMatches = tournament?.matches.filter((match) => match.stage === "knockout") ?? [];

  return (
    <section className="esports-page tournament-manager-page tournament-editor-page">
      <div className="manager-editor-header">
        <div>
          <div className="tournament-detail-breadcrumbs"><Link to="/esports/manage">CONTROL ROOM</Link><span>/</span><strong>{isNew ? "NEW EVENT" : tournament?.name}</strong></div>
          <p className="esports-eyebrow">{isNew ? "TOURNAMENT BUILDER" : "DEVELOPER CONTROL ROOM"}</p>
          <h2>{isNew ? "CREATE TOURNAMENT" : tournament?.name}</h2>
          {!isNew && tournament && <p>{tournament.participantCount} entrants · {tournament.completedMatches}/{tournament.totalMatches} results · Updated {new Date(tournament.updatedAt).toLocaleString()}</p>}
        </div>
        {!isNew && tournament?.published && <Link to={`/esports/${encodeURIComponent(tournament.slug)}`} className="esports-secondary-button">VIEW PUBLIC PAGE</Link>}
      </div>

      {!isNew && (
        <nav className="manager-tabs" aria-label="Tournament management sections">
          {([
            ["setup", "Setup & publish"],
            ["entrants", "Entrants & groups"],
            ["groups", "Group stage"],
            ["knockout", "Knockout"],
            ["log", "Battle log"],
          ] as Array<[ManagerTab, string]>).map(([id, label]) => (
            <button type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>{label}</button>
          ))}
        </nav>
      )}

      {error && <div className="tournament-message tournament-message-error" role="alert">{error}</div>}
      {notice && <div className="tournament-message tournament-message-success" role="status">{notice}</div>}

      {(isNew || tab === "setup") && (
        <form className="manager-panel tournament-setup-form" onSubmit={saveSetup}>
          <header className="manager-panel-heading"><div><span>01</span><h3>IDENTITY & PUBLISHING</h3></div><p>Public-facing event details and visibility controls.</p></header>
          <div className="manager-form-grid manager-form-grid-3">
            <label><span>Tournament name *</span><input required minLength={3} value={draft.name} onChange={(event) => {
              const name = event.target.value;
              updateField("name", name);
              if (isNew) updateField("slug", name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
            }} /></label>
            <label><span>Public URL slug *</span><input required minLength={3} value={draft.slug} onChange={(event) => updateField("slug", event.target.value)} /></label>
            <label><span>Host *</span><input required value={draft.hostName} onChange={(event) => updateField("hostName", event.target.value)} /></label>
            <label className="manager-span-2"><span>Tagline</span><input maxLength={180} value={draft.tagline} onChange={(event) => updateField("tagline", event.target.value)} /></label>
            <label><span>Region</span><input value={draft.region} onChange={(event) => updateField("region", event.target.value)} /></label>
            <label className="manager-span-3"><span>Overview</span><textarea value={draft.description} onChange={(event) => updateField("description", event.target.value)} placeholder="Explain the stakes, format, and who the event is for." /></label>
          </div>
          <header className="manager-panel-heading manager-subheading"><div><span>02</span><h3>EVENT BANNER</h3></div><p>Used across the tournament directory and event header.</p></header>
          <div className="tournament-banner-editor">
            <div className="tournament-banner-preview">
              {(selectedBannerPreview || tournament?.bannerImageUrl) ? (
                <img src={selectedBannerPreview ?? tournament?.bannerImageUrl ?? ""} alt="Tournament banner preview" />
              ) : (
                <div><strong>NO BANNER SET</strong><span>The bracket preview remains visible until an image is uploaded.</span></div>
              )}
            </div>
            <div className="tournament-banner-controls">
              <div>
                <strong>WIDE EVENT ARTWORK</strong>
                <p>PNG or JPEG. A 16:5 image is recommended; the directory card uses a centered crop.</p>
                {bannerPolicy?.enabled && <small>Maximum file size: {formatFileSize(bannerPolicy.maxFileSizeBytes)}</small>}
              </div>
              {isNew ? (
                <p className="tournament-banner-note">Create the tournament first, then return to Setup & publish to upload its banner.</p>
              ) : !bannerPolicy?.enabled ? (
                <p className="tournament-banner-note">R2 image storage is unavailable. Check the existing attachment storage configuration.</p>
              ) : (
                <>
                  <label className="tournament-banner-picker">
                    <span>{selectedBanner ? "CHOOSE A DIFFERENT IMAGE" : "CHOOSE IMAGE"}</span>
                    <input
                      type="file"
                      accept={attachmentAccept(bannerPolicy)}
                      onClick={(event) => { event.currentTarget.value = ""; }}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        try {
                          setSelectedBanner(mergeSelectedFiles([], [file], bannerPolicy)[0] ?? null);
                          setError(null);
                        } catch (reason) {
                          setSelectedBanner(null);
                          setError(reason instanceof Error ? reason.message : "That banner image is invalid.");
                        }
                      }}
                    />
                  </label>
                  {selectedBanner && <small>{selectedBanner.name} · {formatFileSize(selectedBanner.size)}</small>}
                  <div className="tournament-banner-actions">
                    <button
                      type="button"
                      className="esports-primary-button"
                      disabled={working !== null || !selectedBanner}
                      onClick={() => {
                        if (!auth || !tournament || !selectedBanner) return;
                        void runAction(
                          "banner",
                          () => uploadTournamentBanner(tournament.id, selectedBanner, auth.csrfToken),
                          "Tournament banner uploaded.",
                        ).then(() => setSelectedBanner(null)).catch(() => undefined);
                      }}
                    >{working === "banner" ? "UPLOADING…" : tournament?.banner ? "REPLACE BANNER" : "UPLOAD BANNER"}</button>
                    {tournament?.banner && (
                      <button
                        type="button"
                        className="danger"
                        disabled={working !== null}
                        onClick={() => {
                          if (!auth || !tournament || !window.confirm("Remove this tournament banner? The bracket preview will be shown instead.")) return;
                          void runAction(
                            "banner-remove",
                            () => deleteTournamentBanner(tournament.id, auth.csrfToken),
                            "Tournament banner removed.",
                          ).then(() => setSelectedBanner(null)).catch(() => undefined);
                        }}
                      >REMOVE</button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="manager-divider" />
          <div className="manager-form-grid manager-form-grid-3">
            <label><span>Starts</span><input type="datetime-local" value={localFromIso(draft.startsAt)} onChange={(event) => updateField("startsAt", isoFromLocal(event.target.value))} /></label>
            <label><span>Ends</span><input type="datetime-local" value={localFromIso(draft.endsAt)} onChange={(event) => updateField("endsAt", isoFromLocal(event.target.value))} /></label>
            <label><span>Display timezone</span><input value={draft.timezone} onChange={(event) => updateField("timezone", event.target.value)} /></label>
            <label><span>Event state</span><select value={draft.status} onChange={(event) => updateField("status", event.target.value as TournamentInput["status"])}>
              <option value="draft">Draft</option><option value="scheduled">Upcoming</option><option value="live">Live</option><option value="completed">Completed</option><option value="archived">Archived</option>
            </select></label>
            <label><span>Registration</span><select value={draft.registrationStatus} onChange={(event) => updateField("registrationStatus", event.target.value as TournamentInput["registrationStatus"])}>
              <option value="open">Open</option><option value="closed">Closed</option><option value="invite_only">Invite only</option>
            </select></label>
            <label><span>Public contact</span><input value={draft.contact} onChange={(event) => updateField("contact", event.target.value)} /></label>
            <label><span>Registration URL</span><input type="url" value={draft.registrationUrl} onChange={(event) => updateField("registrationUrl", event.target.value)} placeholder="https://…" /></label>
            <label><span>Stream URL</span><input type="url" value={draft.streamUrl} onChange={(event) => updateField("streamUrl", event.target.value)} placeholder="https://…" /></label>
            <div className="manager-checkboxes">
              <label><input type="checkbox" checked={draft.published} onChange={(event) => updateField("published", event.target.checked)} /><span>Publish on Esports page</span></label>
              <label><input type="checkbox" checked={draft.featured} onChange={(event) => updateField("featured", event.target.checked)} /><span>Feature above other events</span></label>
            </div>
          </div>

          <header className="manager-panel-heading manager-subheading"><div><span>03</span><h3>FORMAT & AUTOMATION</h3></div><p>Built for group stage → single-elimination knockout.</p></header>
          <div className="manager-form-grid manager-form-grid-4">
            <label><span>Participant capacity</span><input type="number" min="2" max="256" value={draft.settings.participantCap} onChange={(event) => updateSetting("participantCap", Number(event.target.value))} /></label>
            <label><span>Number of groups</span><input type="number" min="1" max="64" value={draft.settings.groupCount} onChange={(event) => updateSetting("groupCount", Number(event.target.value))} /></label>
            <label><span>Qualifiers per group</span><input type="number" min="1" max="16" value={draft.settings.qualifiersPerGroup} onChange={(event) => updateSetting("qualifiersPerGroup", Number(event.target.value))} /></label>
            <label><span>Group distribution</span><select value={draft.settings.seedingMode} onChange={(event) => updateSetting("seedingMode", event.target.value as TournamentInput["settings"]["seedingMode"])}>
              <option value="random">Fully random</option><option value="balanced">Balanced by ISR (snake)</option><option value="manual">Highest ISR first</option>
            </select></label>
            <label><span>Points for win</span><input type="number" min="-20" max="100" value={draft.settings.pointsWin} onChange={(event) => updateSetting("pointsWin", Number(event.target.value))} /></label>
            <label><span>Points for draw</span><input type="number" min="-20" max="100" value={draft.settings.pointsDraw} onChange={(event) => updateSetting("pointsDraw", Number(event.target.value))} /></label>
            <label><span>Points for loss</span><input type="number" min="-20" max="100" value={draft.settings.pointsLoss} onChange={(event) => updateSetting("pointsLoss", Number(event.target.value))} /></label>
            <label><span>Group series</span><input type="number" min="1" max="99" value={draft.settings.groupBestOf} onChange={(event) => updateSetting("groupBestOf", Number(event.target.value))} /></label>
            <label><span>Knockout series</span><input type="number" min="1" max="99" value={draft.settings.knockoutBestOf} onChange={(event) => updateSetting("knockoutBestOf", Number(event.target.value))} /></label>
            <div className="manager-checkboxes manager-span-3">
              <label><input type="checkbox" checked={draft.settings.allowDraws} onChange={(event) => updateSetting("allowDraws", event.target.checked)} /><span>Allow group draws</span></label>
              <label><input type="checkbox" checked={draft.settings.autoAdvance} onChange={(event) => updateSetting("autoAdvance", event.target.checked)} /><span>Auto-build knockout when groups finish</span></label>
              <label><input type="checkbox" checked={draft.settings.thirdPlaceMatch} onChange={(event) => updateSetting("thirdPlaceMatch", event.target.checked)} /><span>Third-place match</span></label>
              <label><input type="checkbox" checked={draft.settings.checkInRequired} onChange={(event) => updateSetting("checkInRequired", event.target.checked)} /><span>Require entrant check-in</span></label>
            </div>
          </div>
          <div className="format-summary-strip">
            <div><span>GROUP FIELD</span><strong>Up to {Math.ceil(draft.settings.participantCap / draft.settings.groupCount)} per group</strong></div>
            <div><span>KNOCKOUT FIELD</span><strong>Up to {draft.settings.groupCount * draft.settings.qualifiersPerGroup} qualifiers</strong></div>
            <div><span>TIEBREAK ORDER</span><strong>Points → difference → scored → wins → H2H → ISR</strong></div>
          </div>
          <header className="manager-panel-heading manager-subheading"><div><span>04</span><h3>RULEBOOK</h3></div><p>Displayed on the public tournament page.</p></header>
          <label className="manager-full-field"><span>Rules and important information</span><textarea value={draft.rules} onChange={(event) => updateField("rules", event.target.value)} placeholder="Use blank lines to separate rule sections." /></label>
          <footer className="manager-form-actions">
            <Link to="/esports/manage" className="esports-secondary-button">CANCEL</Link>
            <button className="esports-primary-button" type="submit" disabled={working !== null || !draft.name.trim() || !draft.slug.trim()}>{working === "setup" ? "SAVING…" : isNew ? "CREATE TOURNAMENT" : "SAVE CONFIGURATION"}</button>
          </footer>
        </form>
      )}

      {!isNew && tournament && tab === "entrants" && (
        <div className="manager-panel">
          <header className="manager-panel-heading"><div><span>01</span><h3>ENTRANTS & GROUP ASSIGNMENT</h3></div><p>{tournament.participantCount}/{tournament.settings.participantCap} confirmed</p></header>
          <div className="bulk-entry-panel">
            <div><h4>BULK ADD ENTRANTS</h4><p>One entrant per line: <code>Display name | Roblox username | ISR</code>. Username is optional; ISR defaults to 100.</p></div>
            <textarea value={bulkEntrants} onChange={(event) => setBulkEntrants(event.target.value)} placeholder={"Atomic | AtomicRoblox | 1250\nNova | NovaPlayer | 980"} />
            <button
              type="button"
              className="esports-primary-button"
              disabled={working !== null || !bulkEntrants.trim()}
              onClick={() => {
                if (!auth) return;
                const entrants = bulkEntrants.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
                  const [displayName = "", robloxUsername = "", isr = ""] = line.split("|").map((part) => part.trim());
                  return { displayName, robloxUsername, isr: isr ? Number(isr) : 100 };
                });
                void runAction("participants", () => addTournamentParticipants(tournament.id, entrants, auth.csrfToken), `${entrants.length} entrant${entrants.length === 1 ? "" : "s"} added.`)
                  .then(() => setBulkEntrants(""))
                  .catch(() => undefined);
              }}
            >ADD ENTRANTS</button>
          </div>
          <div className="group-action-bar">
            <div><strong>GROUP TOOLS</strong><span>Assignments stay editable until results are saved.</span></div>
            <button type="button" disabled={working !== null || confirmedParticipants.length < 2} onClick={() => {
              if (!auth || !window.confirm("Assign every confirmed entrant using the selected group distribution? This will replace any unsaved schedule.")) return;
              void runAction("randomize", () => randomizeTournamentGroups(tournament.id, auth.csrfToken), "Groups assigned.").catch(() => undefined);
            }}>ASSIGN GROUPS</button>
            <button type="button" disabled={working !== null || confirmedParticipants.some((participant) => !participant.groupId)} onClick={() => {
              if (!auth) return;
              void runAction("schedule", () => generateTournamentGroupSchedule(tournament.id, auth.csrfToken), "Round-robin group schedule generated.").catch(() => undefined);
            }}>GENERATE GROUP MATCHES</button>
          </div>
          <div className="participant-editor-list">
            {tournament.participants.length === 0 ? <div className="tournament-empty-state">Add entrants to begin assigning the field.</div> : [...tournament.participants]
              .sort((left, right) => right.isr - left.isr || left.displayName.localeCompare(right.displayName))
              .map((participant) => (
              <ParticipantEditor
                participant={participant}
                groupCount={tournament.settings.groupCount}
                checkInRequired={tournament.settings.checkInRequired}
                disabled={working !== null}
                key={participant.id}
                onSave={async (changes) => {
                  if (!auth) return;
                  await runAction("participant", () => updateTournamentParticipant(tournament.id, participant.id, changes, auth.csrfToken), `${participant.displayName} updated.`);
                }}
                onRemove={async () => {
                  if (!auth || !window.confirm(`Remove ${participant.displayName} from this tournament?`)) return;
                  await runAction("participant", () => removeTournamentParticipant(tournament.id, participant.id, auth.csrfToken), `${participant.displayName} removed.`);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {!isNew && tournament && tab === "groups" && (
        <div className="manager-stage-layout">
          <div className="manager-panel">
            <header className="manager-panel-heading"><div><span>01</span><h3>LIVE STANDINGS</h3></div><p>Standings recalculate from every saved result.</p></header>
            <TournamentStandings standings={tournament.standings} qualifiersPerGroup={tournament.settings.qualifiersPerGroup} />
          </div>
          <div className="manager-panel point-adjustment-panel">
            <header className="manager-panel-heading"><div><span>02</span><h3>POINT ADJUSTMENT</h3></div><p>Corrections are added to the public battle log.</p></header>
            <div className="manager-form-grid manager-form-grid-4">
              <label className="manager-span-2"><span>Participant</span><select value={adjustParticipantId} onChange={(event) => setAdjustParticipantId(event.target.value)}><option value="">Select entrant…</option>{confirmedParticipants.map((participant) => <option value={participant.id} key={participant.id}>{participant.displayName}</option>)}</select></label>
              <label><span>Point change</span><input type="number" min="-1000" max="1000" value={adjustDelta} onChange={(event) => setAdjustDelta(event.target.value)} /></label>
              <button className="esports-primary-button point-adjust-button" type="button" disabled={working !== null || !adjustParticipantId || !adjustReason.trim()} onClick={() => {
                if (!auth) return;
                void runAction("points", () => adjustTournamentPoints(tournament.id, adjustParticipantId, { delta: Number(adjustDelta), reason: adjustReason }, auth.csrfToken), "Standings adjustment saved.")
                  .then(() => { setAdjustReason(""); setAdjustDelta("0"); })
                  .catch(() => undefined);
              }}>APPLY</button>
              <label className="manager-span-4"><span>Public reason *</span><input value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} placeholder="Required for audit transparency" /></label>
            </div>
          </div>
          <div className="manager-panel">
            <header className="manager-panel-heading"><div><span>03</span><h3>GROUP MATCH CONTROL</h3></div><p>Save completed scores to update standings and the battle log.</p></header>
            <div className="match-filter-row"><label><span>Show group</span><select value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)}><option value="all">All groups</option>{tournament.standings.map((group) => <option value={group.id} key={group.id}>{group.label}</option>)}</select></label><span>{groupMatches.length} matches</span></div>
            <div className="manager-match-list">
              {groupMatches.length === 0 ? <div className="tournament-empty-state">Generate the group schedule from the Entrants tab first.</div> : groupMatches.map((match) => (
                <MatchEditor
                  match={match}
                  participants={tournament.participants}
                  disabled={working !== null}
                  key={match.id}
                  onSave={async (input) => {
                    if (!auth) return;
                    await runAction("match", () => updateTournamentMatch(tournament.id, match.id, input, auth.csrfToken), "Match saved and standings recalculated.");
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {!isNew && tournament && tab === "knockout" && (
        <div className="manager-stage-layout">
          <div className="manager-panel">
            <header className="manager-panel-heading"><div><span>01</span><h3>KNOCKOUT BRACKET</h3></div><div className="manager-heading-actions"><span>{tournament.groupStageComplete ? "GROUPS COMPLETE" : "QUALIFIERS PENDING"}</span><button type="button" disabled={working !== null || !tournament.groupStageComplete} onClick={() => {
              if (!auth || !window.confirm("Generate or rebuild the knockout bracket from the current group standings?")) return;
              void runAction("knockout", () => generateTournamentKnockout(tournament.id, auth.csrfToken), "Knockout bracket generated.").catch(() => undefined);
            }}>GENERATE / REBUILD</button></div></header>
            <TournamentBracket tournament={tournament} />
          </div>
          <div className="manager-panel">
            <header className="manager-panel-heading"><div><span>02</span><h3>KNOCKOUT MATCH CONTROL</h3></div><p>Winners automatically flow into the next bracket slot.</p></header>
            <div className="manager-match-list">
              {knockoutMatches.length === 0 ? <div className="tournament-empty-state">The bracket is created automatically when all groups finish, or you can generate it above.</div> : knockoutMatches.map((match) => (
                <MatchEditor
                  match={match}
                  participants={tournament.participants}
                  disabled={working !== null}
                  key={match.id}
                  onSave={async (input) => {
                    if (!auth) return;
                    await runAction("match", () => updateTournamentMatch(tournament.id, match.id, input, auth.csrfToken), "Knockout result saved and winner advanced.");
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {!isNew && tournament && tab === "log" && (
        <div className="manager-stage-layout manager-log-layout">
          <div className="manager-panel">
            <header className="manager-panel-heading"><div><span>01</span><h3>PUBLISH ANNOUNCEMENT</h3></div><p>Add a host update to the public battle log.</p></header>
            <div className="manager-form-grid">
              <label><span>Headline *</span><input value={announcementHeadline} maxLength={140} onChange={(event) => setAnnouncementHeadline(event.target.value)} /></label>
              <label><span>Details</span><textarea value={announcementDetail} maxLength={1000} onChange={(event) => setAnnouncementDetail(event.target.value)} /></label>
              <button className="esports-primary-button" type="button" disabled={working !== null || announcementHeadline.trim().length < 3} onClick={() => {
                if (!auth) return;
                void runAction("log", () => addTournamentAnnouncement(tournament.id, { headline: announcementHeadline, detail: announcementDetail }, auth.csrfToken), "Announcement published.")
                  .then(() => { setAnnouncementHeadline(""); setAnnouncementDetail(""); })
                  .catch(() => undefined);
              }}>PUBLISH TO LOG</button>
            </div>
          </div>
          <div className="manager-panel">
            <header className="manager-panel-heading"><div><span>02</span><h3>PUBLIC BATTLE LOG</h3></div><p>{tournament.log.length} retained entries</p></header>
            <TournamentBattleLog entries={tournament.log} />
          </div>
        </div>
      )}
    </section>
  );
}

export default function TournamentManagerPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  return tournamentId ? <TournamentEditor tournamentId={tournamentId} /> : <ManagerDashboard />;
}
