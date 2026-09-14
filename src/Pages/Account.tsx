import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "../router";
import { useAuth } from "../AuthContext";
import { loadAccountResource, loadDictionaries, markAccountActivityRead } from "../api";
import { isBugStaff } from "../roles";
import RoleBadge from "../Components/RoleBadge";
import RobloxConnection from "../Components/RobloxConnection";
import type { AccountCalendar, AccountEvent, AccountPeriod, AccountProfile, AccountReports, AccountStats, DictionaryEntry } from "../types";
import "./Account.css";
const MyApplications = lazy(() => import("./Applications").then(module => ({ default: module.MyApplications })));

const periods: { id: AccountPeriod; label: string }[] = [
  { id: "24h", label: "24 hours" }, { id: "7d", label: "7 days" }, { id: "30d", label: "30 days" }, { id: "lifetime", label: "Lifetime" },
];
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const number = (value: number) => value.toLocaleString();

function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    loadAccountResource<T>(path, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load this section.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision]);
  return { data, setData, error, loading, reload: () => setRevision(value => value + 1) };
}

function ResourceState({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => void }) {
  if (error) return <div className="account-error" role="alert"><p>This section couldn’t be loaded. Your saved data has not been cleared.</p><p>{error}</p><button className="secondary-button" onClick={reload}>TRY AGAIN</button></div>;
  if (loading) return <p className="account-muted" role="status">Loading…</p>;
  return null;
}

function ContributionCalendar({ data }: { data: AccountCalendar }) {
  const [selected, setSelected] = useState<{ date: string; count: number } | null>(null);
  const [focusedDate, setFocusedDate] = useState(data.days.at(-1)!.date);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth; }, []);
  const firstDay = new Date(`${data.days[0]!.date}T00:00:00Z`).getUTCDay();
  const cells = [...Array.from({ length: firstDay }, () => null), ...data.days];
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, index) => cells.slice(index * 7, index * 7 + 7));
  const activeDays = data.days.filter(day => day.count > 0).length;
  const total = data.days.reduce((sum, day) => sum + day.count, 0);
  return <>
    <div className="account-calendar-scroll" ref={scroll} tabIndex={0} aria-label="Report contribution calendar. Scroll horizontally to see earlier months.">
      <div className="account-calendar">
        <div className="account-calendar-labels" aria-hidden="true"><span>Sun</span><span>Tue</span><span>Thu</span><span>Sat</span></div>
        {weeks.map((week, index) => <div className="account-calendar-week" key={index}>
          <span className="account-calendar-month">{week.find(day => day?.date.endsWith("-01"))?.date ? new Date(`${week.find(day => day?.date.endsWith("-01"))!.date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }) : ""}</span>
          {week.map((day, row) => day ? <button key={day.date} id={`contribution-day-${day.date}`} className="account-day" data-level={Math.min(day.count, 4)} tabIndex={focusedDate === day.date ? 0 : -1}
            aria-label={`${day.date}: ${number(day.count)} reports`} title={`${day.date}: ${number(day.count)} reports`}
            onClick={() => { setSelected(day); setFocusedDate(day.date); }} onFocus={() => setSelected(day)} onKeyDown={event => {
              const moves: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
              const move = moves[event.key];
              if (move === undefined) return;
              event.preventDefault();
              const index = data.days.findIndex(item => item.date === day.date);
              const next = data.days[Math.max(0, Math.min(data.days.length - 1, index + move))]!;
              setFocusedDate(next.date);
              document.getElementById(`contribution-day-${next.date}`)?.focus();
            }} /> : <span className="account-day is-blank" key={`blank-${row}`} />)}
        </div>)}
      </div>
    </div>
    <div className="account-calendar-footer">
      <span aria-live="polite">{selected ? `${selected.date} · ${number(selected.count)} reports` : `${number(total)} reports across ${number(activeDays)} active days`}</span>
      <div className="account-legend" aria-label="Darker cells mean fewer reports; brighter cells mean more."><span>Less</span>{[0, 1, 2, 3, 4].map(level => <i className="account-day" data-level={level} key={level} />)}<span>More</span></div>
    </div>
    <p className="account-footnote">Past 365 days · UTC · Counts refresh at most every 15 minutes.{data.limited ? ` Showing the latest ${number(data.limit)} report records; some daily totals may be incomplete. The statistics above include all submitted reports.` : ""}</p>
  </>;
}

export default function Account() {
  const { auth, recheck, logout } = useAuth();
  const user = auth!.user;
  const staff = isBugStaff(user.role);
  const { search } = useLocation();
  const [tab, setTab] = useState(() => new URLSearchParams(search).get("tab") ?? "overview");
  useEffect(() => { setTab(new URLSearchParams(search).get("tab") ?? "overview"); }, [search]);
  const [period, setPeriod] = useState<AccountPeriod>("30d");
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [statuses, setStatuses] = useState<DictionaryEntry[]>([]);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [seen, setSeen] = useState<string | null>(null);
  const profile = useResource<{ profile: AccountProfile; robloxLinkingEnabled: boolean }>("/");
  const [linkOutcome, setLinkOutcome] = useState(() => new URLSearchParams(window.location.search).get("roblox"));
  const linkMessages: Record<string, string> = {
    linked: "Your Roblox account is now linked to your profile.",
    cancelled: "Roblox linking was cancelled. Your existing connection has not changed.",
    expired: "Your linking request expired. Please start again while signed in to Discord.",
    changed: "Your Roblox connection changed while you were linking. Please start again.",
    already_linked: "That Roblox account is already linked to another website account. Unlink it there first.",
    not_configured: "Roblox linking is not available yet. Please try again later.",
    failed: "Roblox linking could not be completed. Please try again.",
  };
  useEffect(() => {
    if (!linkOutcome) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("roblox");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [linkOutcome]);
  const stats = useResource<AccountStats>(staff ? "/stats" : null);
  const calendar = useResource<AccountCalendar>(staff ? "/calendar" : null);
  const reports = useResource<AccountReports>(staff ? `/reports?${new URLSearchParams({ ...(status ? { status } : {}), ...(pages.at(-1) ? { cursor: pages.at(-1)! } : {}) })}` : null);
  const activity = useResource<{ events: AccountEvent[] }>(staff ? "/activity" : null);
  useEffect(() => {
    if (!staff) return;
    let active = true;
    loadDictionaries().then(value => { if (active) setStatuses(value.statuses); }).catch(() => {});
    return () => { active = false; };
  }, [staff]);
  const activitySeenAt = seen ?? profile.data?.profile.activitySeenAt;
  const events = activity.data?.events ?? [];
  const isUnread = (event: AccountEvent) => event.actor.discordId !== user.id && (!activitySeenAt || event.createdAt > activitySeenAt);
  const unread = events.filter(isUnread).length;

  async function perform(name: string, action: () => Promise<unknown>) {
    setWorking(name); setMessage(null);
    try { await action(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "The action failed. Please try again."); }
    finally { setWorking(null); }
  }

  const tabs = [{ id: "overview", label: "Overview" }, ...(staff ? [{ id: "reports", label: "My reports" }, { id: "activity", label: "Activity" }] : []), { id: "applications", label: "Applications" }, { id: "connections", label: "Connections" }];
  const currentTab = tabs.some(item => item.id === tab) ? tab : "overview";
  function switchTab(value: string) {
    if (value === "overview") { setStatus(""); setPages([null]); }
    setTab(value);
  }
  const reportsPanel = (preview: boolean) => <section className="account-card">
    <div className="account-card-heading"><div><p className="section-kicker">YOUR TESTING WORK</p><h3>{preview ? "Recent reports" : "My reports"}</h3></div>
      {preview ? <button className="account-text-button" onClick={() => switchTab("reports")}>View all →</button> : <label className="account-filter">Status<select aria-label="Report status" value={status} onChange={event => { setStatus(event.target.value); setPages([null]); }}><option value="">All statuses</option>{statuses.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>}
    </div>
    <ResourceState {...reports} />
    {reports.data && (reports.data.reports.length ? <div className="account-report-list">{reports.data.reports.slice(0, preview ? 4 : 20).map(report => <Link className="account-report" key={report.id} to={`/bugs/${encodeURIComponent(report.id)}`}>
      <div className="account-report-copy"><span className="account-report-id">{report.displayId}<span>{date(report.createdAt)}</span></span><strong>{report.description}</strong><span className="account-report-meta">{report.version?.label} · {number(report.commentsCount ?? 0)} comments</span></div>
      <div className="account-report-badges"><span className="dictionary-badge" style={report.status?.color ? { color: report.status.color, borderColor: report.status.color } : undefined}>{report.status?.label ?? "Status unavailable"}</span>
        <small>Review: {report.submissionState === "uploading" ? "Upload unfinished" : report.approval?.state === "pending" ? "Pending approval" : report.approval?.state === "rejected" ? "Rejected" : "Approved"}</small></div>
      <span className="account-report-arrow" aria-hidden="true">↗</span>
    </Link>)}</div> : <div className="account-empty"><h4>{status ? "No reports with this status" : "Your next discovery starts here"}</h4><p>{status ? "Choose another status to see more of your reports." : "Reports you submit will appear here with their latest review and resolution status."}</p>{!status && <Link className="secondary-button" to="/bugs/new">REPORT A BUG</Link>}</div>)}
    {!preview && <div className="account-pagination"><button className="secondary-button" disabled={pages.length === 1 || reports.loading} onClick={() => setPages(value => value.slice(0, -1))}>PREVIOUS</button><span>Page {pages.length}</span><button className="secondary-button" disabled={!reports.data?.nextCursor || reports.loading} onClick={() => setPages(value => [...value, reports.data!.nextCursor])}>NEXT</button></div>}
  </section>;
  const activityPanel = (preview: boolean) => <section className="account-card">
    <div className="account-card-heading"><div><p className="section-kicker">STAY IN THE LOOP</p><h3>{preview ? "Recent activity" : "Report activity"}</h3></div>{preview ? <button className="account-text-button" onClick={() => switchTab("activity")}>View all →</button> : <button className="account-text-button" disabled={!unread || !!working || !profile.data} onClick={() => void perform("read", async () => { const result = await markAccountActivityRead(events[0]!.createdAt, auth!.csrfToken); setSeen(result.activitySeenAt); })}>{working === "read" ? "Saving…" : "Mark all as read"}</button>}</div>
    <ResourceState {...activity} />
    {activity.data && (events.length ? <ol className="account-activity-list">{events.slice(0, preview ? 4 : 30).map(event => <li key={event.id} data-unread={isUnread(event)}><span className="account-activity-dot" aria-hidden="true" /><Link to={`/bugs/${encodeURIComponent(event.reportId)}`}><p><strong>{event.actor.displayName}</strong> {event.summary}.</p><span>{event.displayId} · <time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString()}>{new Date(event.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>{isUnread(event) && <b className="account-new">NEW</b>}</span></Link></li>)}</ol> : <div className="account-empty"><h4>You’re all caught up</h4><p>New comments, review decisions, and status changes on your reports will appear here.</p></div>)}
    <p className="account-footnote">Latest 30 updates · Activity tracking starts with this dashboard. Open a report for its full history.</p>
  </section>;

  return <section className="content-band account-dashboard" aria-labelledby="account-heading">
    <header className="account-welcome"><div><p className="section-kicker">YOUR PROFILE</p><h2 id="account-heading">Welcome back, {user.displayName}.</h2><p>View your reports, activity and recent updates on applications.</p></div>{staff && <Link className="primary-button" to="/bugs/new">+ REPORT A BUG</Link>}</header>
    <div className="account-layout">
      <aside className="account-sidebar"><section className="account-card account-identity">
        {user.avatarUrl ? <img className="account-avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <div className="account-avatar account-avatar-fallback" aria-hidden="true">{user.displayName.slice(0, 1).toUpperCase()}</div>}
        <h3>{user.displayName}</h3><p className="account-handle">@{user.username}</p><RoleBadge role={user.role} label={user.roleLabel} account />
        <dl className="account-details"><div><dt>ACCOUNT CREATED</dt><dd>{profile.data ? date(profile.data.profile.firstLoginAt) : "—"}</dd></div>{user.guildNickname && <div><dt>SERVER NICKNAME</dt><dd>{user.guildNickname}</dd></div>}<div><dt>ROBLOX ACCOUNT</dt><dd>{profile.data?.profile.roblox ? <><a className="account-profile-link" href={`https://www.roblox.com/users/${profile.data.profile.roblox.userId}/profile`} target="_blank" rel="noopener noreferrer">@{profile.data.profile.roblox.username} ↗</a><small className="account-roblox-id">ID: {profile.data.profile.roblox.userId}</small></> : <button className="account-text-button" onClick={() => switchTab("connections")}>Link Roblox →</button>}</dd></div><div><dt>SIGN-IN METHOD</dt><dd><span className="account-connected-dot" /> Discord</dd></div></dl>
        <ResourceState {...profile} /><p className="account-footnote">Account dates are recorded from your first sign-in with the new dashboard.</p>
        <div className="account-session-actions"><button className="secondary-button" disabled={!!working} onClick={() => void perform("role", recheck)}>{working === "role" ? "CHECKING…" : "RE-CHECK DISCORD ROLE"}</button><button className="account-text-button account-signout" disabled={!!working} onClick={() => void perform("logout", logout)}>SIGN OUT</button></div>
      </section><div className="account-sidebar-note"><span className="section-kicker">BUILT TOGETHER</span><p>Every useful report brings Tower Eclipse one step closer to a better experience.</p><Link to="/bugs">Explore the bug tracker ↗</Link></div></aside>
      <div className="account-main">
        <div className="account-tabs" role="tablist" aria-label="Account sections">{tabs.map((item, index) => <button id={`account-tab-${item.id}`} key={item.id} role="tab" aria-selected={currentTab === item.id} aria-controls={`account-panel-${item.id}`} tabIndex={currentTab === item.id ? 0 : -1} onClick={() => switchTab(item.id)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          switchTab(tabs[next]!.id); document.getElementById(`account-tab-${tabs[next]!.id}`)?.focus();
        }}>{item.label}{item.id === "activity" && unread > 0 && <span className="account-tab-count" aria-label={`${unread} unread updates`}> {unread}</span>}</button>)}</div>
        {message && <div className="message error" role="alert">{message}</div>}{linkOutcome && <div className="account-link-notice" role="status">{linkMessages[linkOutcome] ?? linkMessages.failed}</div>}
        <div className="account-tab-panel" id={`account-panel-${currentTab}`} role="tabpanel" aria-labelledby={`account-tab-${currentTab}`}>
          {currentTab === "overview" && <>
            <Suspense fallback={<p role="status">Loading applications…</p>}><MyApplications preview /></Suspense>
            {staff ? <>
              <section className="account-card account-impact"><div className="account-card-heading"><div><p className="section-kicker">YOUR CONTRIBUTIONS</p><h3>Make every report count.</h3></div><div className="account-periods" role="group" aria-label="Report statistics period">{periods.map(item => <button key={item.id} aria-pressed={period === item.id} onClick={() => setPeriod(item.id)}>{item.label}</button>)}</div></div>
                <ResourceState {...stats} />{stats.data && <div className="account-stat-block" aria-live="polite"><strong>{number(stats.data.counts[period])}</strong><div><h4>bug reports submitted</h4><p>{period === "lifetime" ? "Across your time with Tower Eclipse" : `In the last ${periods.find(item => item.id === period)!.label.toLowerCase()}`}</p></div><span className="account-stat-decoration" aria-hidden="true">↗</span></div>}
                <p className="account-footnote">Includes approved, rejected, and pending reports. Unfinished uploads and deleted reports are excluded.{stats.data ? ` Updated ${new Date(stats.data.asOf).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.` : ""}</p>
              </section>
              <section className="account-card"><div className="account-card-heading"><div><p className="section-kicker">A YEAR OF TESTING</p><h3>Contribution activity</h3></div><span className="account-tag">365 DAYS</span></div><ResourceState {...calendar} />{calendar.data && <ContributionCalendar data={calendar.data} />}</section>
              {reportsPanel(true)}{activityPanel(true)}
            </> : <section className="account-card account-member-welcome"><p className="section-kicker">WELCOME TO THE COMMUNITY</p><h3>Your home in Tower Eclipse.</h3><p>Keep up with development, explore community reports, and follow the latest news. Testers and developers also get personal report tracking here.</p><div className="button-row"><Link className="primary-button" to="/news">LATEST NEWS</Link><Link className="secondary-button" to="/bugs">BROWSE REPORTS</Link></div></section>}
            <section className="account-card account-future-inline"><div><span className="account-tag">ON THE HORIZON</span><h3>One account. More of your world.</h3><p>Connect your Roblox identity now. In-game progress is coming in a future update.</p></div><button className="account-text-button" onClick={() => switchTab("connections")}>Explore connections →</button></section>
          </>}
          {currentTab === "reports" && reportsPanel(false)}
          {currentTab === "applications" && <Suspense fallback={<p role="status">Loading applications…</p>}><MyApplications /></Suspense>}
          {currentTab === "activity" && activityPanel(false)}
          {currentTab === "connections" && <section className="account-card"><div className="account-card-heading"><div><p className="section-kicker">YOUR CONNECTED WORLD</p><h3>Account connections</h3></div></div><div className="account-connection"><img className="account-connection-symbol" src="/social/discord.png" alt="" /><div><h4>Discord</h4><p>@{user.username}</p><small>Your website identity and community role.</small></div><span className="account-tag is-connected">CONNECTED</span></div><ResourceState {...profile} />{profile.data && <RobloxConnection account={profile.data.profile.roblox ?? null} enabled={profile.data.robloxLinkingEnabled} csrfToken={auth!.csrfToken} onChanged={() => { setLinkOutcome(null); profile.reload(); }} />}<div className="account-game-preview"><p className="section-kicker">IN-GAME PROGRESS</p><h3>Your story beyond the website.</h3><p>A future home for your Tower Eclipse stats, milestones, and achievements. Game data isn’t connected yet.</p></div></section>}
        </div>
        {staff && <div className="account-refresh"><span>Updates load when you open this page.</span><button className="account-text-button" disabled={reports.loading || activity.loading || stats.loading || calendar.loading} onClick={() => { reports.reload(); activity.reload(); stats.reload(); calendar.reload(); }}>↻ Refresh dashboard</button></div>}
      </div>
    </div>
  </section>;
}
