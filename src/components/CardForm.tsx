"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { DEFAULT_SCHEDULING_STATE } from "@/lib/scheduler";
import { CardContent } from "@/components/CardContent";
import type { Card } from "@/lib/types";

interface Props {
  deckId: string;
  cardId?: string; // undefined = create mode
}

type FieldMode = "write" | "preview";

const CODE_LANGUAGES = [
  "js",
  "ts",
  "python",
  "java",
  "c",
  "cpp",
  "csharp",
  "go",
  "rust",
  "ruby",
  "php",
  "sql",
  "bash",
  "html",
  "css",
  "json",
] as const;

/** Wraps the textarea's current selection (or the whole value) in a fenced
 * code block, defaulting the selection to a "code" placeholder when empty. */
function wrapSelectionInFence(
  el: HTMLTextAreaElement,
  value: string,
  lang: string,
): string {
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const selected = value.slice(start, end) || "code";
  const before = value.slice(0, start);
  const after = value.slice(end);
  const leadingNewline = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const trailingNewline = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
  return `${before}${leadingNewline}\`\`\`${lang}\n${selected}\n\`\`\`${trailingNewline}${after}`;
}

export function CardForm({ deckId, cardId }: Props) {
  const { cards } = useRepositories();
  const { ownerId } = useAuth();
  const router = useRouter();
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [alternateAnswers, setAlternateAnswers] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState(""); // comma-separated input value
  const [labels, setLabels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Card | null>(null);
  const [frontMode, setFrontMode] = useState<FieldMode>("write");
  const [backMode, setBackMode] = useState<FieldMode>("write");
  const [insertLang, setInsertLang] = useState<string>(CODE_LANGUAGES[0]);
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!cardId) return;
    cards.getById(cardId).then((c) => {
      if (c) {
        setExisting(c);
        setFront(c.front);
        setBack(c.back);
        setAlternateAnswers(c.alternateAnswers ?? []);
        setLabels(c.labels ?? []);
        setLabelInput((c.labels ?? []).join(", "));
      }
    });
  }, [cardId, cards]);

  function parseLabels(raw: string): string[] {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function addAlternate() {
    setAlternateAnswers((prev) => [...prev, ""]);
  }

  function updateAlternate(index: number, value: string) {
    setAlternateAnswers((prev) =>
      prev.map((a, i) => (i === index ? value : a)),
    );
  }

  function removeAlternate(index: number) {
    setAlternateAnswers((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const f = front.trim();
    const b = back.trim();
    if (!f || !b) {
      setError("Both front and back are required.");
      return;
    }
    const alts = alternateAnswers.map((a) => a.trim()).filter(Boolean);
    const lbs = parseLabels(labelInput);
    setSaving(true);
    setError(null);
    try {
      if (existing) {
        await cards.update(existing.id, {
          front: f,
          back: b,
          alternateAnswers: alts,
          labels: lbs,
        });
      } else {
        await cards.create({
          deckId,
          ownerId,
          front: f,
          back: b,
          alternateAnswers: alts,
          labels: lbs,
          scheduling: DEFAULT_SCHEDULING_STATE(),
        });
      }
      router.push(`/decks/${deckId}`);
    } catch {
      setError("Failed to save card.");
      setSaving(false);
    }
  }

  return (
    <div className="w-full max-w-lg mx-auto py-10 px-4 space-y-6">
      <h1 className="text-title tracking-tight">
        {existing ? "Edit card" : "New card"}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <FieldEditor
          label="Front"
          value={front}
          onChange={setFront}
          mode={frontMode}
          setMode={setFrontMode}
          textareaRef={frontRef}
          placeholder="Question or prompt…"
          insertLang={insertLang}
          setInsertLang={setInsertLang}
        />
        <FieldEditor
          label="Back (primary answer)"
          value={back}
          onChange={setBack}
          mode={backMode}
          setMode={setBackMode}
          textareaRef={backRef}
          placeholder="Answer…"
          insertLang={insertLang}
          setInsertLang={setInsertLang}
        />

        {/* Alternate accepted answers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-micro text-ink-2">
              Alternate answers
              <span className="ml-1 text-ink-3">
                (other phrasings that are also correct)
              </span>
            </label>
            <button
              type="button"
              onClick={addAlternate}
              className="text-micro text-accent-hi hover:opacity-80 transition-opacity"
            >
              + Add
            </button>
          </div>
          {alternateAnswers.length === 0 && (
            <p className="text-meta text-ink-3">
              None — the primary answer above is the only accepted answer.
            </p>
          )}
          {alternateAnswers.map((alt, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={alt}
                onChange={(e) => updateAlternate(i, e.target.value)}
                placeholder={`Alternate answer ${i + 1}…`}
                className="flex-1 rounded-control bg-surface-2 border border-line-2 px-4 py-2.5 text-base text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => removeAlternate(i)}
                className="text-meta text-incorrect hover:opacity-80 transition-opacity px-1"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Labels */}
        <div className="space-y-1.5">
          <label className="block text-micro text-ink-2">
            Labels
            <span className="ml-1 text-ink-3">(comma-separated)</span>
          </label>
          <input
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            placeholder="e.g. vocab, chapter-3, hard"
            className="w-full rounded-control bg-surface-2 border border-line-2 px-4 py-3 text-base text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {parseLabels(labelInput).length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {parseLabels(labelInput).map((l) => (
                <span
                  key={l}
                  className="text-micro rounded-chip bg-accent-soft text-accent-hi px-2.5 py-1"
                >
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-meta text-incorrect">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="text-button rounded-control bg-accent text-on-accent px-5 py-3 hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? "Saving…" : existing ? "Save changes" : "Add card"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/decks/${deckId}`)}
            className="text-button rounded-control border border-line-2 text-ink-2 px-5 py-3 hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

interface FieldEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mode: FieldMode;
  setMode: (mode: FieldMode) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  insertLang: string;
  setInsertLang: (lang: string) => void;
}

/** Write/Preview toggle over a textarea, with an "Insert code block" affordance
 * that wraps the current selection in fences — the plain textarea stays the
 * source of truth throughout (see docs/feature-analysis-report.md §B3). */
function FieldEditor({
  label,
  value,
  onChange,
  mode,
  setMode,
  textareaRef,
  placeholder,
  insertLang,
  setInsertLang,
}: FieldEditorProps) {
  function handleInsertCodeBlock() {
    const el = textareaRef.current;
    if (!el) return;
    onChange(wrapSelectionInFence(el, value, insertLang));
    requestAnimationFrame(() => el.focus());
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between flex-wrap gap-y-1.5">
        <label className="block text-micro text-ink-2">{label}</label>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <select
            value={insertLang}
            onChange={(e) => setInsertLang(e.target.value)}
            disabled={mode === "preview"}
            className="text-micro rounded-control bg-surface-2 border border-line-2 px-2 py-1 text-ink-2 disabled:opacity-40"
          >
            {CODE_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleInsertCodeBlock}
            disabled={mode === "preview"}
            className="text-micro text-accent-hi hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity whitespace-nowrap"
          >
            + Code block
          </button>
          <div className="flex bg-surface-2 border border-line rounded-control p-0.5 gap-0.5">
            {(["write", "preview"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 rounded-segment text-micro capitalize transition-colors ${
                  mode === m ? "bg-surface-3 text-ink-1" : "text-ink-3"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
      {mode === "write" ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          placeholder={placeholder}
          className="w-full rounded-control bg-surface-2 border border-line-2 px-4 py-3 text-base text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent resize-none"
        />
      ) : (
        <div className="w-full rounded-control bg-surface-2 border border-line-2 px-4 py-3 min-h-[6.5rem]">
          {value.trim() === "" ? (
            <p className="text-base text-ink-3">Nothing to preview yet.</p>
          ) : (
            <CardContent text={value} className="text-base text-ink-1" />
          )}
        </div>
      )}
    </div>
  );
}
