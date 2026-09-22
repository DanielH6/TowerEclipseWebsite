import { useState } from 'react';
import type { LinkedReport } from '../types';
import RelatedReports from './RelatedReports';
import { Link } from '../router';
export default function UpdateReportLinks({ links, onChange, disabled }: { links: LinkedReport[]; onChange: (links: LinkedReport[]) => void; disabled: boolean }) {
  const [search, setSearch] = useState('');
  return <section className="panel-card workflow-panel"><h3>LINKED BUG REPORTS</h3><p>Connect fixes to their original reports. Edit the public wording below; linking never changes the original report or publishes this draft.</p>
    {links.map((link, index) => <div className="linked-report-editor" key={link.id}><Link to={`/bugs/${link.id}`} target="_blank">{link.displayId ?? link.id} ↗</Link><label className="editor-field"><span>Public release-note wording</span><textarea maxLength={1000} disabled={disabled} value={link.summary} onChange={event => onChange(links.map((item, i) => i === index ? { ...item, summary: event.target.value } : item))} /></label><button type="button" className="ghost-link" disabled={disabled} onClick={() => onChange(links.filter(item => item.id !== link.id))}>UNLINK</button></div>)}
    <label className="editor-field"><span>Find reports to link</span><input disabled={disabled} value={search} onChange={event => setSearch(event.target.value)} placeholder="Report ID or issue description" /></label>
    {!disabled && <RelatedReports search={search} onSelect={report => { if (!links.some(item => item.id === report.id)) onChange([...links, { id: report.id, displayId: report.displayId, summary: report.description.slice(0, 1000) }]); setSearch(''); }} />}
  </section>;
}
