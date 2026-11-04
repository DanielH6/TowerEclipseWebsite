import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { useLocation, useNavigate } from "../router";
import { useCareerResource } from "../careers";
import { CareerResourceState } from "./CareerFields";
import CareerAiReviewPanel from "./CareerAiReviewPanel";
import { ApplicationList } from "../Pages/Applications";

interface ReviewForm { id: string; title: string; category: string; state: string; createdAt: string | null; applications: number }
export default function CareerReviewWorkspace() {
  const { auth } = useAuth(), { search } = useLocation(), navigate = useNavigate();
  const params = new URLSearchParams(search), selected = params.get("formId") ?? "";
  const forms = useCareerResource<{ items: ReviewForm[] }>("/admin/review-forms");
  const [refresh, setRefresh] = useState(0);
  const completed = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    if (params.has("formId") || !forms.data?.items.length) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem("career-review-form"); } catch { /* Selection persistence is optional. */ }
    const initial = forms.data.items.find(item => item.id === saved) ?? forms.data.items.find(item => item.applications > 0) ?? forms.data.items[0]!;
    navigate(`/admin/careers/review?${new URLSearchParams({ formId: initial.id, ...(params.get("status") ? { status: params.get("status")! } : {}) })}`, { replace: true });
  }, [forms.data, search, navigate]);
  const current = forms.data?.items.find(item => item.id === selected);
  return <section className="career-card career-review-workspace">
    <div className="career-review-selection"><label>Select application form<select aria-label="Select application form" value={selected} disabled={forms.loading} onChange={e => {
      const value = e.target.value;
      try { localStorage.setItem("career-review-form", value); } catch { /* The URL still preserves the selection. */ }
      navigate(`/admin/careers/review?${new URLSearchParams({ formId: value })}`);
    }}><option value="">All forms · overview</option>{selected && !current && <option value={selected}>Selected opening</option>}{forms.data?.items.map(item => <option key={item.id} value={item.id}>{item.title} · {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : item.category} · {item.state} · {item.applications} applications</option>)}</select></label><button type="button" className="career-link" disabled={forms.loading} onClick={forms.reload}>Refresh forms</button></div>
    <CareerResourceState {...forms} />
    {selected ? <><p className="career-help">{current?.category ?? "Selected opening"} · Only applications submitted to this recruitment form are shown.</p>{auth?.user.role === "dev" && <CareerAiReviewPanel key={selected} formId={selected} onComplete={completed} />}</> : <p className="career-notice">Choose one form to search, sort by AI score, edit criteria or request a review. The overview combines applications for browsing.</p>}
    <ApplicationList key={selected} admin formId={selected} refreshToken={refresh} />
  </section>;
}
