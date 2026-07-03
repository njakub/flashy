import type { PrismTheme } from "prism-react-renderer";

/**
 * Token colors reference the app's CSS custom properties (globals.css)
 * rather than hardcoded hex values, so the highlighted code automatically
 * follows the existing `prefers-color-scheme` light/dark switch with no JS
 * theme-detection logic needed — CSS variables resolve fine inside the
 * inline styles prism-react-renderer applies per token.
 */
export const flashyCodeTheme: PrismTheme = {
  plain: {
    color: "var(--color-ink-1)",
    backgroundColor: "transparent",
  },
  styles: [
    {
      types: ["comment", "prolog", "doctype", "cdata"],
      style: { color: "var(--color-ink-3)", fontStyle: "italic" },
    },
    {
      types: ["keyword", "tag", "selector", "atrule"],
      style: { color: "var(--color-accent-hi)" },
    },
    {
      types: ["string", "attr-value", "char", "inserted"],
      style: { color: "var(--color-correct)" },
    },
    {
      types: ["function", "class-name", "builtin"],
      style: { color: "var(--color-self-grade)" },
    },
    {
      types: ["number", "boolean", "constant", "deleted"],
      style: { color: "var(--color-incorrect)" },
    },
    {
      types: ["punctuation", "operator", "property", "attr-name"],
      style: { color: "var(--color-ink-2)" },
    },
  ],
};
