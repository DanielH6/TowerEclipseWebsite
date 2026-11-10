import { useEffect, useRef, useState } from "react";
import type { TextFormatting } from "./Components/CareerRichText";

export type QuestionType = "short" | "paragraph" | "choice" | "checkboxes" | "ranking" | "scale";
export interface CareerQuestion { id: string; type: QuestionType; label: string; help: string; required: boolean; options?: string[]; min?: number; max?: number; minLabel?: string; maxLabel?: string; formatting?: TextFormatting; image?: { id: string; alt: string } }
export interface FormDraft { title: string; category: string; description: string; commitment: string; confirmation: string; closesAt: string | null; questions: CareerQuestion[]; formatting?: TextFormatting }
export interface AiCriterion { id: string; name: string; description: string; weight: number; low: string; middle: string; high: string }
export interface AiReviewSettings { brief: string; criteria: AiCriterion[]; examples: { question: string; answer: string; score: number; notes: string }[] }
export interface AiAssessment { relativeScore: number; qualityScore: number; rank: number; poolSize: number; runId: string; reviewedAt: string; criteriaChanged: boolean; model?: string; reasoningEffort?: AiReasoningEffort; summary: string; observations: string; grades: { criterionId: string; name: string; weight: number; score: number; explanation: string; evidence: { questionId: string; question: string; quote: string }[] }[] }
export type AiReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";
export interface AiModelOption { id: string; label: string; inputUsdPerMillion: number; outputUsdPerMillion: number }
export interface AiRun { id: string; state: "queued" | "running" | "completed" | "failed" | "cancelled"; total: number; processed: number; createdAt: string; completedAt: string | null; error: string; criteriaRevision: number; model: string; reasoningEffort?: AiReasoningEffort; requestedBy: { id: string; displayName: string }; usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; reasoningTokens?: number } }
export interface AiReviewOverview { configured: boolean; model: string; defaultReasoningEffort: AiReasoningEffort; models: AiModelOption[]; reasoningEfforts: AiReasoningEffort[]; criteriaRevision: number; hasCriteria: boolean; runs: AiRun[]; hasHistory?: boolean; completedRun: { id: string; total: number; completedAt: string; criteriaRevision: number; model?: string; reasoningEffort?: AiReasoningEffort } | null }
export const emptyAiReview = (): AiReviewSettings => ({ brief: "", criteria: [], examples: [] });
export interface CareerForm extends FormDraft { id: string; state: "draft" | "open" | "closed"; revision: number; publishedVersion: string | null; versionId?: string; draft: FormDraft; aiReview?: AiReviewSettings; aiRevision?: number; createdAt: string; updatedAt: string }
export type Answers = Record<string, string | string[] | number>;
export interface CareerApplicationDraft { versionId: string; answers: Answers; revision: number; updatedAt: string; applicationRevision: number | null; form?: FormDraft }
export interface ApplicantFormData { form: CareerForm; identity: ApplicantIdentity; existingApplicationId: string | null; draft: CareerApplicationDraft | null; acceptingApplications: boolean }
export interface ApplicantIdentity { discordId: string; username: string; displayName: string; roblox: { userId: string; username: string } }
export const applicationStatuses = { submitted: "Submitted", under_review: "Under review", shortlisted: "Shortlisted", accepted: "Accepted", rejected: "Rejected", withdrawn: "Withdrawn" };
export type ApplicationStatus = keyof typeof applicationStatuses;
export interface ApplicationReadState { readByYou: boolean; readers: { id: string; displayName: string; readAt: string }[] }
export interface CareerApplication { id: string; formId: string; versionId: string; title: string; category: string; applicantId: string; applicant: ApplicantIdentity; status: ApplicationStatus; createdAt: string; updatedAt: string; resubmittedAt?: string; revision: number; submissionRevision?: number; readState?: ApplicationReadState; feedback: string; aiReview?: AiAssessment | null; feedbackFormatting?: TextFormatting; notesFormatting?: TextFormatting; answers: Answers; history: { at: string; status: ApplicationStatus; feedback: string; feedbackFormatting?: TextFormatting }[]; internalNotes?: string; reviewer?: { id: string; displayName: string } | null }
export interface ApplicationDetail { application: CareerApplication; form: FormDraft; canResubmit: boolean; closesAt: string | null; draft?: CareerApplicationDraft | null }
export interface CareerPageResult<T> { items: T[]; nextCursor: string | null; asOf?: string; maxAgeSeconds?: number }
export interface ApplicationStats { applicants: number; applications: number; categories: { category: string; applicants: number; applications: number }[]; openings: { id: string; title: string; applicants: number; applications: number }[]; asOf?: string; maxAgeSeconds?: number }
export function answerWordCount(value: Answers[string] | undefined) { return typeof value === "string" ? (value.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? []).length : 0; }
export function applicationWordCount(form: FormDraft, answers: Answers) { return form.questions.reduce((total, q) => total + (["short", "paragraph"].includes(q.type) ? answerWordCount(answers[q.id]) : 0), 0); }
export const careerImageUrl = (id: string) => `/api/careers/images/${encodeURIComponent(id)}`;
export async function careerRequest<T>(path: string, options: { method?: string; body?: unknown; csrf?: string; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`/api/careers${path}`, { credentials: "include", method: options.method ?? "GET", signal: options.signal,
    headers: { Accept: "application/json", ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}) },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? "Applications could not be loaded. Please try again.");
  return data as T;
}
export function useCareerResource<T>(path: string | null) {
  const [result, setResult] = useState<{ path: string | null; data: T | null; error: string; loading: boolean }>({ path, data: null, error: "", loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (path === null) { setResult({ path, data: null, error: "", loading: false }); return; }
    const controller = new AbortController();
    setResult({ path, data: null, error: "", loading: true });
    careerRequest<T>(path, { signal: controller.signal }).then(data => setResult({ path, data, error: "", loading: false })).catch(error => {
      if (!controller.signal.aborted) setResult({ path, data: null, error: error.message, loading: false });
    });
    return () => controller.abort();
  }, [path, revision]);
  return { ...(result.path === path ? result : { data: null, error: "", loading: true }), reload: () => setRevision(value => value + 1) };
}
export function careerDate(value: string | null | undefined) { return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "No closing date"; }
export function moveItem<T>(items: T[], index: number, direction: number): T[] {
  const next = [...items], destination = index + direction;
  if (destination < 0 || destination >= items.length) return next;
  [next[index], next[destination]] = [next[destination]!, next[index]!];
  return next;
}
export const applicationUnsavedMessage = "Leave this page? Use Save draft first to keep your answers. Unsaved edits will be lost.";
export function useUnsavedChanges(dirty: boolean, message = "Leave this page? Unsaved changes will be lost.") {
  const pending = useRef(dirty);
  pending.current = dirty;
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (pending.current) { event.preventDefault(); event.returnValue = message; } };
    const navigation = (event: Event) => { if (pending.current && !window.confirm(message)) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("app:navigate", navigation);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("app:navigate", navigation); };
  }, [dirty, message]);
  // A successful mutation can navigate in the same tick, before React commits its saved state.
  return () => { pending.current = false; };
}
