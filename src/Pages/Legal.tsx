import { useEffect } from "react";
import { Link } from "../router";
import { legalDetails, privacyPolicy, termsOfService } from "../content/legalContent";
import "./Legal.css";

export default function Legal({ document }: { document: "privacy" | "terms" }) {
  const policy = document === "privacy" ? privacyPolicy : termsOfService;
  const ready = legalDetails.contactEmail && legalDetails.location && legalDetails.effectiveDate;
  useEffect(() => {
    const previous = window.document.title;
    window.document.title = `${policy.title} | Tower Eclipse`;
    // Route links can arrive at a particular policy section.
    if (window.location.hash) window.document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    return () => { window.document.title = previous; };
  }, [policy.title]);
  return <main className="legal-page" id="legal-top">
    <header className="legal-introduction">
      <p className="section-kicker">TOWER ECLIPSE · COMMUNITY & ACCOUNTS</p>
      <h1>{policy.title}</h1>
      <p>{policy.description}</p>
      <div className="legal-meta"><span>{ready ? `Effective ${legalDetails.effectiveDate}` : "Draft for review"}</span><span>{legalDetails.operator}</span></div>
    </header>
    {!ready && <aside className="legal-draft" role="status"><strong>Draft — awaiting operator confirmation.</strong> Contact details, operating location, and the effective date must be confirmed before these policies are published for use.</aside>}
    <div className="legal-layout">
      <aside className="legal-sidebar">
        <nav aria-label="Legal documents" className="legal-document-nav"><Link to="/privacy" aria-current={document === "privacy" ? "page" : undefined}>Privacy Policy</Link><Link to="/terms" aria-current={document === "terms" ? "page" : undefined}>Terms of Service</Link></nav>
        <nav aria-label="On this page" className="legal-contents"><p>ON THIS PAGE</p>{policy.sections.map((section, index) => <a key={section.id} href={`#${section.id}`}><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{section.title}</a>)}</nav>
      </aside>
      <article className="legal-document">
        <section className="legal-summary" aria-labelledby="legal-summary-title"><h2 id="legal-summary-title">At a glance</h2><ul>{policy.summary.map(item => <li key={item}>{item}</li>)}</ul><p>The full details are below.</p></section>
        {policy.sections.map((section, index) => <section className="legal-section" id={section.id} key={section.id}><h2><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{section.title}</h2>{section.content}</section>)}
        <div className="legal-bottom"><a href="#legal-top">Back to top ↑</a><Link to="/login">Your account →</Link></div>
      </article>
    </div>
  </main>;
}
