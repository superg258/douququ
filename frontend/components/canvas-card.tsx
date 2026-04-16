"use client";

import type { CanvasCard, MatchCanvasCard, TeamCanvasCard } from "@/lib/types";

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function toneClass(tone: CanvasCard["tone"]) {
  switch (tone) {
    case "amber":
      return "tone-amber";
    case "emerald":
      return "tone-emerald";
    case "steel":
      return "tone-steel";
    default:
      return "tone-cyan";
  }
}

function teamStateClass(teamKey: string, selectedTeamKey: string | null, highlightedTeamKey: string | null) {
  if (teamKey === selectedTeamKey) {
    return "is-selected";
  }
  if (teamKey === highlightedTeamKey) {
    return "is-highlighted";
  }
  return "";
}

function MatchRowLine({
  side,
  showProbability,
  selectedTeamKey,
  highlightedTeamKey,
  onTeamSelect,
}: {
  side: MatchCanvasCard["redSide"];
  showProbability: boolean;
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  onTeamSelect: (teamKey: string) => void;
}) {
  const sideClass = `match-team-row ${showProbability ? "with-probability" : "no-probability"} ${side.side} ${teamStateClass(side.teamKey, selectedTeamKey, highlightedTeamKey)} ${side.isWinner ? "is-winner" : "is-loser"}`;

  return (
    <button
      type="button"
      className={sideClass}
      title={`${side.collegeName} ${side.teamName} ${showProbability ? formatPercent(side.probability) : ""}`.trim()}
      onClick={(event) => {
        event.stopPropagation();
        onTeamSelect(side.teamKey);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      style={{ ["--team-fill" as string]: `${Math.max(10, Math.min(100, side.probability * 100))}%` }}
    >
      <span className={`team-score-box ${side.side}`}>{side.score}</span>
      <span className="team-primary">
        <strong>{side.collegeName}</strong>
        <small>{side.teamName}</small>
      </span>
      <span className="team-meta-cluster">
        {showProbability ? (
          <span className={`team-probability ${side.isWinner ? "winner" : "loser"}`}>
            {formatPercent(side.probability)} {side.isWinner ? "胜" : "负"}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function MatchCardView({
  card,
  selectedTeamKey,
  highlightedTeamKey,
  selectedMatchLabel,
  onTeamSelect,
  onMatchSelect,
}: {
  card: MatchCanvasCard;
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  selectedMatchLabel: string | null;
  onTeamSelect: (teamKey: string) => void;
  onMatchSelect: (matchLabel: string) => void;
}) {
  const selected = selectedMatchLabel === card.match.matchLabel ? "is-selected" : "";
  const headless = card.variant === "compact" || card.variant === "playoff";
  const variantClass = card.variant ?? "standard";
  const showProbability = card.showProbability ?? true;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`canvas-card match-card ${variantClass} ${toneClass(card.tone)} ${selected}`}
      style={{
        left: card.x,
        top: card.y,
        width: card.width,
        height: card.height,
      }}
      onClick={() => onMatchSelect(card.match.matchLabel)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onMatchSelect(card.match.matchLabel);
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="card-order-rail">{card.orderLabel}</span>
      <div className="card-shell">
        {!headless ? (
          <div className="match-card-head">
            <strong>{card.displayLabel}</strong>
            <span>{card.metaLabel}</span>
          </div>
        ) : null}
        <div className="match-card-body">
          <MatchRowLine
            side={card.redSide}
            showProbability={showProbability}
            selectedTeamKey={selectedTeamKey}
            highlightedTeamKey={highlightedTeamKey}
            onTeamSelect={onTeamSelect}
          />
          <MatchRowLine
            side={card.blueSide}
            showProbability={showProbability}
            selectedTeamKey={selectedTeamKey}
            highlightedTeamKey={highlightedTeamKey}
            onTeamSelect={onTeamSelect}
          />
        </div>
      </div>
    </div>
  );
}

function TeamCardView({
  card,
  selectedTeamKey,
  highlightedTeamKey,
  onTeamSelect,
}: {
  card: TeamCanvasCard;
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  onTeamSelect: (teamKey: string) => void;
}) {
  return (
    <button
      type="button"
      className={`canvas-card team-card ${card.variant} ${toneClass(card.tone)} ${teamStateClass(card.teamKey, selectedTeamKey, highlightedTeamKey)}`}
      style={{
        left: card.x,
        top: card.y,
        width: card.width,
        height: card.height,
      }}
      title={[card.collegeName, card.teamName, card.statLine, ...(card.meta ?? [])].filter(Boolean).join(" / ")}
      onClick={() => onTeamSelect(card.teamKey)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {card.orderLabel ? <span className="card-order-rail">{card.orderLabel}</span> : null}
      <div className="card-shell">
        <div className="team-card-main">
          <strong>{card.collegeName}</strong>
          <small>{card.subtitle ?? card.teamName}</small>
        </div>
        {card.statLine ? <p className="team-card-stat">{card.statLine}</p> : null}
        {card.meta?.length ? (
          <div className="team-card-meta">
            {card.meta.slice(0, 2).map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        ) : null}
      </div>
    </button>
  );
}

export function CanvasCardView({
  card,
  selectedTeamKey,
  highlightedTeamKey,
  selectedMatchLabel,
  onTeamSelect,
  onMatchSelect,
}: {
  card: CanvasCard;
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  selectedMatchLabel: string | null;
  onTeamSelect: (teamKey: string) => void;
  onMatchSelect: (matchLabel: string) => void;
}) {
  if (card.kind === "match") {
    return (
      <MatchCardView
        card={card}
        selectedTeamKey={selectedTeamKey}
        highlightedTeamKey={highlightedTeamKey}
        selectedMatchLabel={selectedMatchLabel}
        onTeamSelect={onTeamSelect}
        onMatchSelect={onMatchSelect}
      />
    );
  }

  return (
    <TeamCardView
      card={card}
      selectedTeamKey={selectedTeamKey}
      highlightedTeamKey={highlightedTeamKey}
      onTeamSelect={onTeamSelect}
    />
  );
}
