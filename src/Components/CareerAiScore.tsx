import type { CSSProperties } from "react";
import { DIFFICULTIES } from "../../shared/achievement-list.mjs";
import type { AiAssessment } from "../careers";

// The list's authored red/orange/yellow/green palette, ordered for review scores.
const stops = [DIFFICULTIES[4]!.color, DIFFICULTIES[3]!.color, DIFFICULTIES[2]!.color, "#c1e777", DIFFICULTIES[1]!.color];
export function scoreStyle(score: number | null | undefined): CSSProperties {
  let color = "#8996a7";
  if (typeof score === "number" && Number.isFinite(score)) {
    const position = Math.max(0, Math.min(10, score)) / 2.5, index = Math.min(3, Math.floor(position)), fraction = position - index;
    const rgb = (hex: string) => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
    const from = rgb(stops[index]!), to = rgb(stops[index + 1]!);
    color = `rgb(${from.map((channel, i) => Math.round(channel + (to[i]! - channel) * fraction)).join(", ")})`;
  }
  return { "--career-score-color": color } as CSSProperties;
}
export function AiScoreBadge({ review }: { review?: AiAssessment | null }) {
  return <span className={`career-ai-score${review ? "" : " is-unranked"}`} style={scoreStyle(review?.relativeScore)} aria-label={review ? `AI relative score ${review.relativeScore.toFixed(1)} out of 10, rank ${review.rank} of ${review.poolSize}` : "Not AI ranked"}>
    <strong>{review ? review.relativeScore.toFixed(1) : "-"}<small>/10</small></strong><span>{review ? `#${review.rank} of ${review.poolSize}` : "Unranked"}</span>
  </span>;
}
