"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { useAuth } from "@/components/providers/AuthProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { useModelsCatalog } from "@/lib/settings/useModelsCatalog";
import { colorForModel } from "@/lib/settings/chartColors";
import { UsageClient } from "@/lib/usage/UsageClient";
import type {
  DailyPointWire,
  ModelSummaryWire,
  RecommendationWire,
  UsageRange,
  UsageSummaryResponseBody,
} from "@/lib/usage/wire";

const RANGE_OPTIONS: { value: UsageRange; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

const fmtUsd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
const fmtPct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const fmtMs = (n: number) => (n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`);

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-surface-1 p-5">
      <p className="text-micro text-ink-3 uppercase tracking-wide">{label}</p>
      <p className="text-display mt-1 text-ink-1">{value}</p>
    </div>
  );
}

function DailyCostTooltip({
  active,
  payload,
  label,
  displayNameFor,
}: TooltipContentProps & { displayNameFor: (modelId: string) => string }) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .map((p) => ({ ...p, numericValue: Number(p.value) }))
    .filter((p) => Number.isFinite(p.numericValue) && p.numericValue > 0)
    .sort((a, b) => b.numericValue - a.numericValue);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-control border border-line bg-surface-2 px-3 py-2 shadow-lg">
      <p className="text-micro text-ink-3">{label}</p>
      <div className="mt-1 space-y-1">
        {rows.map((row) => (
          <div key={String(row.dataKey)} className="flex items-center gap-2 text-meta">
            <span
              aria-hidden
              className="inline-block h-0.5 w-3"
              style={{ backgroundColor: row.color }}
            />
            <span className="text-ink-2">{displayNameFor(String(row.dataKey))}</span>
            <span className="ml-auto font-semibold text-ink-1">{fmtUsd(row.numericValue)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DailyCostChart({
  daily,
  modelIds,
  displayNameFor,
}: {
  daily: DailyPointWire[];
  modelIds: string[];
  displayNameFor: (modelId: string) => string;
}) {
  if (daily.length === 0) {
    return (
      <p className="text-meta text-ink-3 py-8 text-center">
        No usage in this range yet.
      </p>
    );
  }
  // Only chart models that actually appear in this range's data, in their
  // registry order — keeps the legend from listing models with no bars.
  const modelsInRange = modelIds.filter((id) =>
    daily.some((d) => (d.costUsdByModel[id] ?? 0) > 0),
  );
  const data = daily.map((d) => ({ date: d.date.slice(5), ...d.costUsdByModel }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} barCategoryGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: "var(--color-ink-3)", fontSize: 12 }}
          axisLine={{ stroke: "var(--color-line)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "var(--color-ink-3)", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => fmtUsd(v)}
          width={56}
        />
        <Tooltip
          content={(props) => <DailyCostTooltip {...props} displayNameFor={displayNameFor} />}
          cursor={{ fill: "var(--color-surface-2)" }}
        />
        {modelsInRange.length > 1 && (
          <Legend
            formatter={(value: string) => (
              <span className="text-meta text-ink-2">{displayNameFor(value)}</span>
            )}
          />
        )}
        {modelsInRange.map((id, i) => (
          <Bar
            key={id}
            dataKey={id}
            stackId="cost"
            fill={colorForModel(id, modelIds)}
            radius={i === modelsInRange.length - 1 ? [3, 3, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function CallsByTaskChart({ byModel }: { byModel: ModelSummaryWire[] }) {
  const grading = byModel.filter((m) => m.task === "grading").reduce((s, m) => s + m.calls, 0);
  const generation = byModel
    .filter((m) => m.task === "generation")
    .reduce((s, m) => s + m.calls, 0);
  const data = [
    { task: "Grading", calls: grading },
    { task: "Generation", calls: generation },
  ];
  if (grading + generation === 0) {
    return <p className="text-meta text-ink-3 py-8 text-center">No calls in this range yet.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="task"
          tick={{ fill: "var(--color-ink-2)", fontSize: 13 }}
          axisLine={false}
          tickLine={false}
          width={80}
        />
        <Tooltip
          cursor={{ fill: "var(--color-surface-2)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0];
            return (
              <div className="rounded-control border border-line bg-surface-2 px-3 py-2 shadow-lg">
                <span className="text-meta font-semibold text-ink-1">
                  {p.value as number} calls
                </span>
              </div>
            );
          }}
        />
        <Bar dataKey="calls" fill="var(--color-accent)" radius={[0, 3, 3, 0]} barSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ModelTable({ byModel }: { byModel: ModelSummaryWire[] }) {
  if (byModel.length === 0) {
    return <p className="text-meta text-ink-3 py-4 text-center">No calls in this range yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-meta">
        <thead>
          <tr className="border-b border-line text-left text-micro text-ink-3 uppercase tracking-wide">
            <th className="py-2 pr-3 font-medium">Model</th>
            <th className="py-2 pr-3 font-medium">Task</th>
            <th className="py-2 pr-3 font-medium text-right">Calls</th>
            <th className="py-2 pr-3 font-medium text-right">Cost</th>
            <th className="py-2 pr-3 font-medium text-right">$/call</th>
            <th className="py-2 pr-3 font-medium text-right">Latency</th>
            <th className="py-2 font-medium text-right">Agreement</th>
          </tr>
        </thead>
        <tbody>
          {byModel.map((m) => (
            <tr key={`${m.model}|${m.task}`} className="border-b border-line last:border-0">
              <td className="py-2 pr-3 text-ink-1">{m.displayName}</td>
              <td className="py-2 pr-3 text-ink-2 capitalize">{m.task}</td>
              <td className="py-2 pr-3 text-right text-ink-2">{m.calls}</td>
              <td className="py-2 pr-3 text-right text-ink-2">{fmtUsd(m.costUsd)}</td>
              <td className="py-2 pr-3 text-right text-ink-2">{fmtUsd(m.avgCostPerCallUsd)}</td>
              <td className="py-2 pr-3 text-right text-ink-2">{fmtMs(m.avgLatencyMs)}</td>
              <td className="py-2 text-right text-ink-2">
                {m.agreement
                  ? `${fmtPct(m.agreement.userAgreeRate)} (${m.agreement.userSamples})`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecommendationCard({
  rec,
  displayNameFor,
  onApply,
  applying,
}: {
  rec: RecommendationWire;
  displayNameFor: (modelId: string) => string;
  onApply: () => void;
  applying: boolean;
}) {
  return (
    <div className="rounded-card border border-accent-soft bg-accent-soft p-5 space-y-2">
      <p className="text-micro text-accent-hi uppercase tracking-wide">
        {rec.task === "grading" ? "Grading" : "Generation"} recommendation
      </p>
      <p className="text-body text-ink-1">{rec.reason}</p>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={onApply}
          disabled={applying}
          className="text-button rounded-control bg-accent text-on-accent px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {applying ? "Applying…" : `Switch to ${displayNameFor(rec.recommendedModel)}`}
        </button>
        <span className="text-meta text-ink-3">
          Save ~{fmtUsd(rec.projectedMonthlySavingsUsd)}/month
        </span>
      </div>
    </div>
  );
}

export function UsagePage() {
  const { status, getAccessToken } = useAuth();
  const { setGradingModel, setGenerationModel } = useSettings();
  const { models } = useModelsCatalog();
  const isSignedIn = status === "signedIn";
  const modelIds = models.map((m) => m.id);
  const displayNameFor = (modelId: string) =>
    models.find((m) => m.id === modelId)?.displayName ?? modelId;

  const [range, setRange] = useState<UsageRange>("30d");
  const [summary, setSummary] = useState<UsageSummaryResponseBody | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationWire[]>([]);
  const [applyingTask, setApplyingTask] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    UsageClient.getSummary(getAccessToken, range)
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, range]);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    UsageClient.getRecommendations(getAccessToken)
      .then((result) => {
        if (!cancelled) setRecommendations(result.recommendations);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  async function applyRecommendation(rec: RecommendationWire) {
    setApplyingTask(rec.task);
    if (rec.task === "grading") setGradingModel(rec.recommendedModel);
    else setGenerationModel(rec.recommendedModel);
    setRecommendations((prev) => prev.filter((r) => r.task !== rec.task));
    setApplyingTask(null);
  }

  if (status === "loading") {
    return <div className="p-8 text-ink-3">Loading…</div>;
  }

  return (
    <div className="w-full max-w-3xl mx-auto py-10 px-4 space-y-6">
      <div>
        <Link
          href="/profile"
          className="text-meta text-ink-3 hover:text-ink-1 transition-colors"
        >
          ← Profile
        </Link>
        <h1 className="text-display tracking-tight mt-2">Usage &amp; costs</h1>
      </div>

      {!isSignedIn ? (
        <div className="rounded-card border border-line bg-surface-1 p-6 space-y-2">
          <p className="text-meta text-ink-2">
            Sign in to see your AI usage and costs across devices.
          </p>
          <Link
            href="/login"
            className="inline-block text-button text-accent-hi hover:underline"
          >
            Sign in
          </Link>
        </div>
      ) : (
        <>
          {recommendations.map((rec) => (
            <RecommendationCard
              key={rec.task}
              rec={rec}
              displayNameFor={displayNameFor}
              onApply={() => void applyRecommendation(rec)}
              applying={applyingTask === rec.task}
            />
          ))}

          <div className="flex bg-surface-2 border border-line rounded-control p-1 gap-1 w-fit">
            {RANGE_OPTIONS.map(({ value, label }) => {
              const active = range === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRange(value)}
                  className={`rounded-control px-4 py-2 text-button transition-colors ${
                    active ? "bg-accent text-on-accent" : "text-ink-2 hover:bg-surface-3"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {summary && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="Total spend" value={fmtUsd(summary.totals.costUsd)} />
                <StatTile label="Calls" value={String(summary.totals.calls)} />
                <StatTile label="Failed" value={String(summary.totals.failedCalls)} />
              </div>

              <div className="rounded-card border border-line bg-surface-1 p-6 space-y-3">
                <p className="text-micro text-ink-3 uppercase tracking-wide">
                  Daily cost by model
                </p>
                <DailyCostChart
                  daily={summary.daily}
                  modelIds={modelIds}
                  displayNameFor={displayNameFor}
                />
              </div>

              <div className="rounded-card border border-line bg-surface-1 p-6 space-y-3">
                <p className="text-micro text-ink-3 uppercase tracking-wide">
                  Calls by task
                </p>
                <CallsByTaskChart byModel={summary.byModel} />
              </div>

              <div className="rounded-card border border-line bg-surface-1 p-6 space-y-3">
                <p className="text-micro text-ink-3 uppercase tracking-wide">
                  Per-model comparison
                </p>
                <ModelTable byModel={summary.byModel} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
