/**
 * Fixed-order categorical colors for the usage dashboard's per-model charts —
 * validated (lightness band, chroma floor, CVD adjacent-pair separation,
 * contrast vs. surface) via the dataviz skill's validate_palette.js for both
 * color schemes; see src/app/globals.css for the CSS variable definitions.
 * A model's color is its index in the registry's `models` array (GET
 * /models — the same order flashy-api returns every time), never by cost or
 * rank, so a model keeps the same color across chart types and refetches.
 */
const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const;
const OTHER_COLOR = "var(--color-chart-other)";

export function colorForModel(modelId: string, orderedModelIds: string[]): string {
  const index = orderedModelIds.indexOf(modelId);
  if (index < 0 || index >= CHART_COLORS.length) return OTHER_COLOR;
  return CHART_COLORS[index];
}
