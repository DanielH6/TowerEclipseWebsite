import type { CSSProperties } from "react";
import { DIFFICULTIES, DIFFICULTY_TIERS, difficultyRating } from "../../shared/achievement-list.mjs";

export const difficultyStyle = (color: string): CSSProperties => ({ "--difficulty-color": color } as CSSProperties);

export function DifficultyBadge({ value }: { value: number }) {
  const rating = difficultyRating(value);
  if (!rating) return <span className="difficulty-badge">Set a rating</span>;
  return <span className={`difficulty-badge ${rating.eclipse ? "difficulty-eclipse" : ""}`} style={difficultyStyle(rating.color)} aria-label={`${rating.rating.toFixed(1)} — ${rating.label}`}>
    <strong className="difficulty-value">{rating.rating.toFixed(1)}</strong>
    <span className="difficulty-name"><small>{rating.tier}</small><b>{rating.name}</b></span>
  </span>;
}

export function DifficultySpectrum({ selected = null, onSelect }: { selected?: number | null; onSelect?: (minimum: number | null) => void }) {
  return <section className="difficulty-spectrum" aria-label="Difficulty spectrum">
    <header><div><p className="achievement-kicker">FROM EFFORTLESS TO ECLIPSE</p><h3>The difficulty spectrum</h3></div>{onSelect && <button className="list-button secondary" aria-pressed={selected === null} onClick={() => onSelect(null)}>ALL DIFFICULTIES</button>}</header>
    <div className="difficulty-spectrum-bar" aria-hidden="true" />
    <div className="difficulty-scale">{DIFFICULTIES.map(item => {
      const content = <><span>{item.name}</span><small>{item.range}</small></>;
      const className = `difficulty-scale-item ${item.minimum === 8 ? "difficulty-eclipse" : ""} ${selected === item.minimum ? "active" : ""}`;
      return onSelect ? <button key={item.name} className={className} style={difficultyStyle(item.color)} aria-pressed={selected === item.minimum} onClick={() => onSelect(selected === item.minimum ? null : item.minimum)}>{content}</button>
        : <div key={item.name} className={className} style={difficultyStyle(item.color)}>{content}</div>;
    })}</div>
    <div className="difficulty-tier-guide"><strong>WITHIN EACH DIFFICULTY</strong>{DIFFICULTY_TIERS.map(tier => <span key={tier.name}><b>{tier.name}</b><small>{tier.range}</small></span>)}</div>
  </section>;
}
