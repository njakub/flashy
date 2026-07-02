/**
 * Design tokens — extracted from the "Slate & Indigo" (direction 1a, dark)
 * system in the Flashcard App Redesign Claude Design project
 * (claude.ai/design/p/e28ccdbe-daed-4cca-bae7-45dbfb70d747).
 *
 * Plain data only (hex/rgba strings, unitless numbers, font-name strings) —
 * no CSS, no Tailwind config, no styled-components. This is deliberate: the
 * same object can be read by a React Native theme provider later without
 * translation. How it gets applied to DOM elements (CSS variables bridge,
 * inline styles, etc.) is a web-only concern that lives outside this file.
 *
 * Elevation in this design is expressed as a background step (bg0→bg3) plus
 * a 1px border color, never box-shadow — shadows are unreliable/expensive on
 * native, so stepping the surface color is what ports directly to RN.
 */

export const fontFamily = {
  ui: "Hanken Grotesk, system-ui, sans-serif",
  // Same as `ui` in this direction (1a). A serif card face (Newsreader) is
  // direction 1b ("Ink & Violet") — not the chosen direction.
  card: "Hanken Grotesk, system-ui, sans-serif",
  mono: "IBM Plex Mono, monospace",
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/**
 * Type scale. `letterSpacing` is in em (matches the design's CSS em values
 * directly — a negative value tightens tracking on larger/bolder text).
 */
export const type = {
  display: {
    fontFamily: fontFamily.ui,
    size: 28,
    weight: fontWeight.bold,
    lineHeight: 1.1,
    letterSpacing: -0.02,
  }, // "Decks" heading
  title: {
    fontFamily: fontFamily.ui,
    size: 20,
    weight: fontWeight.semibold,
    lineHeight: 1.2,
    letterSpacing: -0.01,
  }, // deck name / screen title
  cardFront: {
    fontFamily: fontFamily.card,
    size: 26,
    weight: fontWeight.medium,
    lineHeight: 1.32,
    letterSpacing: -0.01,
  },
  cardBack: {
    fontFamily: fontFamily.card,
    size: 25,
    weight: fontWeight.medium,
    lineHeight: 1.34,
    letterSpacing: -0.01,
  },
  body: {
    fontFamily: fontFamily.ui,
    size: 16,
    weight: fontWeight.medium,
    lineHeight: 1.35,
    letterSpacing: 0,
  }, // card row text, primary list content
  meta: {
    fontFamily: fontFamily.ui,
    size: 13,
    weight: fontWeight.regular,
    lineHeight: 1.4,
    letterSpacing: 0,
  }, // "248 cards · 12 due" — always on text2
  micro: {
    fontFamily: fontFamily.ui,
    size: 12,
    weight: fontWeight.medium,
    lineHeight: 1.3,
    letterSpacing: 0,
  }, // chip / label text — always on text3
  statMono: {
    fontFamily: fontFamily.mono,
    size: 13,
    weight: fontWeight.medium,
    lineHeight: 1.2,
    letterSpacing: 0,
  }, // "92% · 47 attempts" — tabular figures for alignment in lists/history
  bigScore: {
    fontFamily: fontFamily.mono,
    size: 72,
    weight: fontWeight.bold,
    lineHeight: 1,
    letterSpacing: -0.03,
  }, // results screen score
  button: {
    fontFamily: fontFamily.ui,
    size: 15,
    weight: fontWeight.semibold,
    lineHeight: 1,
    letterSpacing: 0,
  },
  input: {
    fontFamily: fontFamily.ui,
    size: 16,
    weight: fontWeight.regular,
    lineHeight: 1.3,
    letterSpacing: 0,
  },
} as const;

/** Spacing — 4pt base scale, plain numbers (px). */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

/** Radii, plain numbers (px) — named by usage rather than a generic xs/sm/lg scale. */
export const radius = {
  chip: 8, // label chips, stat/due badges
  icon: 12, // icon/avatar squares (deck monogram, header icon button)
  segment: 13, // segmented-control / tab-bar outer container
  control: 14, // buttons, inputs, individual segment/tab
  row: 16, // list rows (deck row)
  card: 20, // primary content card (question card, result card)
  pill: 9999, // pill-shaped filter chips
} as const;

/**
 * Per-theme color palettes. Same semantic keys in both — only the values
 * differ — so a component never branches on light/dark, it just reads the
 * active palette.
 */
export const colorsDark = {
  bg0: "#0f1218", // base
  bg1: "#161a22", // surface
  bg2: "#1d222c", // raised
  bg3: "#242a36", // overlay
  line: "#272d39",
  line2: "#333b4a",
  text1: "#eef1f7",
  text2: "#a2abbc",
  text3: "#68717f",
  accent: "#6879f0",
  // Secondary/emphasis accent variant (answer text, chip-accent text) — not
  // necessarily "lighter", just the alternate accent tone for this theme.
  accentHi: "#8b97f5",
  accentSoft: "rgba(104,121,240,0.16)",
  correct: "#4fbf92",
  correctSoft: "rgba(79,191,146,0.15)",
  incorrect: "#e37b70",
  incorrectSoft: "rgba(227,123,112,0.15)",
  // "Your call" self-grade band, and reused for the Study-mode "Hard" rating.
  selfGrade: "#d3a45c",
  selfGradeSoft: "rgba(211,164,92,0.15)",
} as const;

export const colorsLight = {
  bg0: "#f4f5f7",
  bg1: "#ffffff",
  bg2: "#ffffff",
  bg3: "#eef0f4",
  line: "#e4e7ec",
  line2: "#d5dae2",
  text1: "#141821",
  text2: "#5c6675",
  text3: "#8b94a3",
  accent: "#4d5fe0",
  accentHi: "#3a4cd0",
  accentSoft: "rgba(77,95,224,0.11)",
  correct: "#2f9e6e",
  correctSoft: "rgba(47,158,110,0.12)",
  incorrect: "#d15a4e",
  incorrectSoft: "rgba(209,90,78,0.12)",
  selfGrade: "#b9832f",
  selfGradeSoft: "rgba(185,131,47,0.13)",
} as const;

/**
 * Constant across both themes: the correct/incorrect/selfGrade colors are
 * mid-luminance in both palettes, so a fixed near-black glyph reads cleanly
 * on top of them (e.g. the ✓/✕ icon on a solid result badge) without needing
 * a theme-dependent flip. `onAccent` is likewise constant — accent is always
 * a mid-to-vivid blue/indigo in both palettes, so white always contrasts.
 */
export const onSemantic = "#0f1218";
export const onAccent = "#ffffff";

export const theme = {
  dark: colorsDark,
  light: colorsLight,
  space,
  radius,
  type,
  fontFamily,
  fontWeight,
  onSemantic,
  onAccent,
} as const;

export type Theme = typeof theme;
export type ThemeColors = typeof colorsDark;
