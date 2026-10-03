export function AchievementModeIcon({ mode }: { mode: "solo" | "grouped" }) {
  return <svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true" focusable="false">
    {mode === "solo" ? <><circle cx="24" cy="13" r="8" /><path d="M9 40c0-9 5.8-15 15-15s15 6 15 15v2H9z" /></>
      : <><g opacity=".55"><circle cx="10" cy="12" r="6" /><circle cx="38" cy="12" r="6" /><path d="M1 33v-3c0-6 3.5-10 9-10 3.2 0 5.7 1.2 7.2 3.5A17 17 0 0 0 8 33zm46 0h-7a17 17 0 0 0-9.2-9.5C32.3 21.2 34.8 20 38 20c5.5 0 9 4 9 10z" /></g><circle cx="24" cy="18" r="7" /><path d="M11 43v-3c0-7.6 5-12 13-12s13 4.4 13 12v3z" /></>}
  </svg>;
}

export default function AchievementMode({ mode }: { mode: "solo" | "grouped" | "" }) {
  return <div className="achievement-mode">{mode && <span className="achievement-mode-badge" role="img" aria-label={`Completion mode: ${mode === "solo" ? "Solo" : "Grouped"}`}><AchievementModeIcon mode={mode} /><span>{mode.toUpperCase()}</span></span>}</div>;
}
