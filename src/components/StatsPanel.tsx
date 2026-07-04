"use client";

import { useCallback, useState } from "react";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { useReloadOnSync } from "@/lib/sync/useReloadOnSync";
import { activityDates, computeStreak, recentAccuracy } from "@/lib/dashboardStats";

const ACCURACY_WINDOW_DAYS = 30;

interface Stats {
  dueToday: number;
  streak: number;
  accuracyPercent: number | null;
}

function accuracyColor(percent: number | null): string {
  if (percent === null) return "text-ink-3";
  if (percent >= 80) return "text-correct";
  if (percent >= 60) return "text-self-grade";
  return "text-incorrect";
}

/** Cross-deck stats — due today, review streak, and 30-day accuracy. All
 * derived from existing repository data, nothing new persisted (same
 * "never stored" precedent as CardStats). */
export function StatsPanel() {
  const { cards, testRuns } = useRepositories();
  const { ownerId } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(async () => {
    const [dueCards, allCards, runs] = await Promise.all([
      cards.getDueCards(null, new Date()),
      cards.getAllByOwner(ownerId),
      testRuns.getRunsByOwner(ownerId),
    ]);
    const streak = computeStreak(activityDates(allCards, runs));
    const accuracy = recentAccuracy(runs, ACCURACY_WINDOW_DAYS);
    setStats({
      dueToday: dueCards.length,
      streak,
      accuracyPercent: accuracy.percent,
    });
  }, [cards, testRuns, ownerId]);

  useReloadOnSync(load);

  if (!stats) return null;

  const tiles = [
    { label: "Due today", value: String(stats.dueToday), color: "text-ink-1" },
    {
      label: "Day streak",
      value: `${stats.streak}${stats.streak > 0 ? " 🔥" : ""}`,
      color: "text-ink-1",
    },
    {
      label: "30-day accuracy",
      value: stats.accuracyPercent === null ? "—" : `${stats.accuracyPercent}%`,
      color: accuracyColor(stats.accuracyPercent),
    },
  ];

  return (
    <div className="flex gap-2.5">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex-1 rounded-row border border-line bg-surface-1 p-4 text-center"
        >
          <p className={`text-title ${tile.color}`}>{tile.value}</p>
          <p className="text-micro text-ink-3 mt-1">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}
