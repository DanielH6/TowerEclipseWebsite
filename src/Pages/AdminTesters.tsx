import { useEffect, useState } from "react";
import { loadAccountResource } from "../api";
import { Link } from "../router";
import RoleBadge from "../Components/RoleBadge";
import type { AccountReports, AccountStats, AccountEvent } from "../types";
import "./Bugs.css";

type Tester = { discordId: string; username: string; displayName: string; avatarUrl: string | null; role: "qa" | "leadqa"; roleVerifiedAt: string; firstLoginAt: string };
type Detail = AccountReports & { stats: AccountStats; activity: AccountEvent[]; onboarding: { version: string; completed: Record<string, string> } | null };
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "—";

function TesterHistory({ tester }: { tester: Tester }) {
  const [data, setData] = useState<Detail | null>(null);
  const [cursor, setCursor] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    loadAccountResource<Detail>(`/testers/${tester.discordId}?cursor=${encodeURIComponent(cursor)}`, controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tester.discordId, cursor, revision]);
  return <article className="panel-card tester-detail">
    <h3>{tester.displayName} <RoleBadge role={tester.role} /></h3>
    <p>@{tester.username} · Discord ID: {tester.discordId}</p>
    <p>First connected: {date(tester.firstLoginAt)} · Rank verified: {date(tester.roleVerifiedAt)}</p>
    {loading && <p role="status">Loading tester history…</p>}
    {error && <div role="alert"><p>{error}</p><button className="primary-action" onClick={() => setRevision(value => value + 1)}>RETRY</button></div>}
    {!loading && !error && data && <>
      <div className="tester-stats">{([['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days'], ['lifetime', 'Lifetime']] as const).map(([key, label]) => <div key={key}><strong>{data.stats.counts[key]}</strong><span>{label}</span></div>)}</div>
      <p>Submitted reports · Counts as of {date(data.stats.asOf)}</p>
      <p>Onboarding: {data.onboarding ? `${Object.keys(data.onboarding.completed).length} steps reviewed · guide ${data.onboarding.version}` : "Not started"} (self-reported).</p>
      <h4>REPORT HISTORY</h4>
      {!data.reports.length && <p>No reports on this page.</p>}
      <ul className="tester-history">{data.reports.map(report => <li key={report.id}>
        <Link to={`/bugs/${report.id}`}>{report.displayId}</Link> · {report.status.label} · {date(report.createdAt)}
        <p>{report.description}</p>
      </li>)}</ul>
      <div className="button-row"><button className="ghost-link" disabled={!cursor} onClick={() => setCursor("")}>FIRST PAGE</button><button className="primary-action" disabled={!data.nextCursor} onClick={() => setCursor(data.nextCursor ?? "")}>NEXT PAGE</button></div>
      <h4>RECENT UPDATES ON THEIR REPORTS</h4>
      <p>The latest 30 comments and review or status updates on this tester’s reports.</p>
      {!data.activity.length && <p>No report updates yet.</p>}
      <ul className="tester-history">{data.activity.map(event => <li key={`${event.reportId}:${event.id}`}><Link to={`/bugs/${event.reportId}`}>{event.displayId}</Link> · {event.actor.displayName} {event.summary.replace(/your report/g, 'this report')} · {date(event.createdAt)}</li>)}</ul>
    </>}
  </article>;
}

export default function AdminTestersPage() {
  const [testers, setTesters] = useState<Tester[]>([]);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [limited, setLimited] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    loadAccountResource<{ testers: Tester[]; limited: boolean }>("/testers", controller.signal)
      .then(value => { if (!controller.signal.aborted) { setTesters(value.testers); setLimited(value.limited); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const visible = testers.filter(tester => (!role || tester.role === role) && `${tester.displayName} ${tester.username} ${tester.discordId}`.toLowerCase().includes(search.toLowerCase()));
  const tester = testers.find(item => item.discordId === selected);
  return <section className="workspace-page">
    <div className="workspace-header"><div><p className="workspace-kicker">DEVELOPER ADMIN</p><h2>TESTER OVERVIEW</h2><p>Connected website accounts with a last verified QA Tester or QA Lead rank.</p></div><div className="button-row"><Link className="ghost-link" to="/admin">ADMIN</Link><button className="primary-action" disabled={loading} onClick={() => setRevision(value => value + 1)}>REFRESH</button></div></div>
    <p>Ranks are checked when users sign in or refresh their Discord role. This is not a live Discord member list or online-status tracker. Existing accounts appear after their next sign-in or account refresh.</p>
    <div className="bug-filters"><label className="filter-field filter-search"><span>Find tester</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, username, Discord ID…" /></label><label className="filter-field"><span>Rank</span><select value={role} onChange={event => setRole(event.target.value)}><option value="">All testers</option><option value="qa">QA Tester</option><option value="leadqa">QA Lead</option></select></label></div>
    {loading && <p role="status">Loading testers…</p>}{error && <p className="workspace-error" role="alert">{error}</p>}
    {limited && <p role="status">Showing up to 500 accounts per rank. Directory results are incomplete.</p>}
    {!loading && !error && <><p>{visible.length} tester{visible.length === 1 ? "" : "s"}</p><div className="tester-layout"><div className="tester-list">{visible.map(item => <button className={`tester-select${selected === item.discordId ? " is-selected" : ""}`} aria-pressed={selected === item.discordId} key={item.discordId} onClick={() => setSelected(item.discordId)}><strong>{item.displayName}</strong><span>@{item.username} · {item.role === "leadqa" ? "QA Lead" : "QA Tester"}</span><small>Verified {date(item.roleVerifiedAt)}</small></button>)}{!visible.length && <p>No testers match. Accounts appear after a verified sign-in.</p>}</div>{tester ? <TesterHistory tester={tester} key={`${tester.discordId}:${revision}`} /> : <p>Select a tester to view their report history and activity.</p>}</div></>}
  </section>;
}
