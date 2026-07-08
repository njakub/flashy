"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { DEFAULT_SCHEDULING_STATE } from "@/lib/scheduler";
import { GenerateClient } from "@/lib/generate/GenerateClient";
import { extractSource } from "@/lib/generate/extractText";
import {
  MAX_SOURCE_TEXT_CHARS,
  MAX_PDF_BYTES,
  type CandidateCardWire,
  type GenerateSource,
} from "@/lib/generate/wire";

/**
 * GenerateCards — "generate cards from text" flow (AI-powered): the user
 * pastes source material or uploads a file (.txt/.md/.html stripped to text
 * client-side; PDF sent as base64 for Claude to read natively), flashy-api's
 * POST /generate drafts candidate cards, and the user reviews/edits/removes
 * them before anything is persisted. Approval loops the same
 * cards.create(...) call the import flow uses — generated cards are ordinary
 * cards (immediately due, synced, gradeable) the moment they land.
 *
 * Requires sign-in, same as AI grading — the Anthropic key never reaches the
 * client, so generation always round-trips through the backend.
 */

interface Props {
  deckId: string;
}

type Phase = "input" | "generating" | "review" | "saving" | "done";

const TARGET_COUNTS = [5, 10, 15, 20] as const;

/** A candidate being reviewed — wire card plus client-side review state. */
interface ReviewCard extends CandidateCardWire {
  /** Front matches an existing deck card — excluded unless re-included. */
  duplicate: boolean;
  /** User removed it from the batch. */
  removed: boolean;
}

/** Maps authedFetch's "Request failed: <status> <body>" to friendly copy. */
function friendlyGenerateError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const status = /Request failed: (\d{3})/.exec(message)?.[1];
  switch (status) {
    case "400":
      return "That material couldn't be processed — it may be corrupt or unsupported.";
    case "401":
      return "Your session expired — sign in again and retry.";
    case "413":
      return "That file is too large (max 10 MB PDF / 100,000 characters of text).";
    case "422":
      return "Claude declined to generate cards from this material.";
    default:
      return status
        ? "Card generation failed — please try again."
        : message; // e.g. "Sign in to use this feature." / network error
  }
}

/** Reads a File as newline-free base64 (data-URL payload). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

export function GenerateCards({ deckId }: Props) {
  const { cards } = useRepositories();
  const { ownerId, status, getAccessToken } = useAuth();
  const isSignedIn = status === "signedIn";

  const [phase, setPhase] = useState<Phase>("input");
  const [error, setError] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [pdf, setPdf] = useState<{ name: string; data: string } | null>(null);
  const [targetCount, setTargetCount] = useState<number>(10);
  const [candidates, setCandidates] = useState<ReviewCard[]>([]);
  const [summary, setSummary] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasSource = pdf !== null || sourceText.trim().length > 0;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setError(null);
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith(".pdf")) {
        if (file.size > MAX_PDF_BYTES) {
          setError("PDF is too large — 10 MB max.");
          return;
        }
        setPdf({ name: file.name, data: await fileToBase64(file) });
        setSourceText("");
      } else {
        const text = extractSource(file.name, await file.text());
        if (!text) {
          setError("That file appears to be empty.");
          return;
        }
        setPdf(null);
        setSourceText(text);
      }
    } catch {
      setError("Failed to read file.");
    }
  }

  async function handleGenerate() {
    const text = sourceText.trim();
    if (!isSignedIn || (!pdf && !text)) return;
    if (!pdf && text.length > MAX_SOURCE_TEXT_CHARS) {
      setError(
        `Text is too long (${text.length.toLocaleString()} characters — max ${MAX_SOURCE_TEXT_CHARS.toLocaleString()}). Trim it down and retry.`,
      );
      return;
    }
    setError(null);
    setPhase("generating");
    const source: GenerateSource = pdf
      ? { type: "pdf", data: pdf.data }
      : { type: "text", text };
    try {
      const [response, existing] = await Promise.all([
        GenerateClient.generate(getAccessToken, { source, targetCount }),
        cards.getByDeck(deckId),
      ]);
      const existingFronts = new Set(existing.map((c) => c.front));
      setCandidates(
        response.cards.map((c) => ({
          ...c,
          duplicate: existingFronts.has(c.front),
          removed: existingFronts.has(c.front),
        })),
      );
      setPhase("review");
    } catch (err) {
      console.error("Card generation failed:", err);
      setError(friendlyGenerateError(err));
      setPhase("input"); // source is preserved in state — user can retry
    }
  }

  function updateCandidate(index: number, patch: Partial<ReviewCard>) {
    setCandidates((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  }

  const kept = candidates.filter((c) => !c.removed && c.front.trim() && c.back.trim());

  async function handleApprove() {
    if (kept.length === 0) return;
    setPhase("saving");
    setError(null);
    try {
      // Re-check fronts at save time — edits during review can introduce
      // duplicates (against the deck or within the batch) that the
      // generation-time check didn't see.
      const existing = await cards.getByDeck(deckId);
      const existingFronts = new Set(existing.map((c) => c.front));
      let added = 0;
      let skipped = 0;
      for (const c of kept) {
        const front = c.front.trim();
        if (existingFronts.has(front)) {
          skipped++;
          continue;
        }
        existingFronts.add(front);
        await cards.create({
          deckId,
          ownerId,
          front,
          back: c.back.trim(),
          alternateAnswers: c.alternateAnswers.map((a) => a.trim()).filter(Boolean),
          labels: c.labels,
          keyPoints: c.keyPoints.map((p) => p.trim()).filter(Boolean),
          scheduling: DEFAULT_SCHEDULING_STATE(),
        });
        added++;
      }
      const parts = [`Added ${added} card${added !== 1 ? "s" : ""}.`];
      if (skipped > 0) {
        parts.push(
          `Skipped ${skipped} duplicate${skipped !== 1 ? "s" : ""} (matching front text).`,
        );
      }
      setSummary(parts.join(" "));
      setPhase("done");
    } catch (err) {
      console.error("Failed to save generated cards:", err);
      setError("Failed to save cards — please try again.");
      setPhase("review");
    }
  }

  function startOver() {
    setPhase("input");
    setCandidates([]);
    setError(null);
    // sourceText / pdf / targetCount are deliberately kept — "start over"
    // means back to the input step, not wiping the material.
  }

  return (
    <div className="w-full max-w-2xl mx-auto py-10 px-4 space-y-6">
      <div>
        <h2 className="text-title">Generate cards</h2>
        <p className="text-meta text-ink-2 mt-1">
          Paste source material or upload a file — Claude drafts flashcards,
          you review and approve them before anything is saved.
        </p>
      </div>

      {error && (
        <div className="rounded-control border border-incorrect-soft bg-incorrect-soft px-4 py-3">
          <p className="text-meta text-incorrect">{error}</p>
        </div>
      )}

      {/* Input step */}
      {(phase === "input" || phase === "generating") && (
        <div className="space-y-4">
          {pdf ? (
            <div className="rounded-card border border-line bg-surface-1 p-4 flex items-center gap-3">
              <span className="text-meta text-ink-1 flex-1 truncate">
                📄 {pdf.name}
              </span>
              <button
                type="button"
                onClick={() => setPdf(null)}
                disabled={phase === "generating"}
                className="text-micro text-ink-3 hover:text-incorrect transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              <textarea
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                rows={10}
                disabled={phase === "generating"}
                placeholder="Paste an article, tutorial transcript, docs page… anything you want to learn."
                className="w-full rounded-control bg-surface-2 border border-line-2 px-4 py-3 text-base text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent resize-y disabled:opacity-60"
              />
              {sourceText.length > 0 && (
                <p
                  className={`text-micro text-right ${
                    sourceText.length > MAX_SOURCE_TEXT_CHARS
                      ? "text-incorrect"
                      : "text-ink-3"
                  }`}
                >
                  {sourceText.length.toLocaleString()} /{" "}
                  {MAX_SOURCE_TEXT_CHARS.toLocaleString()} characters
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={phase === "generating"}
              className="text-micro rounded-chip border border-line text-ink-2 px-3 py-1.5 hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              Upload file
            </button>
            <span className="text-micro text-ink-3">
              .txt, .md, .html or .pdf (10 MB max)
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,text/plain,.md,text/markdown,.html,.htm,text/html,.pdf,application/pdf"
              onChange={handleFile}
              className="hidden"
            />
          </div>

          <div className="space-y-1">
            <p className="text-micro text-ink-3 uppercase tracking-wide">
              How many cards? (a target — fewer if the material is thin)
            </p>
            <div className="flex bg-surface-2 border border-line rounded-control p-1 gap-1">
              {TARGET_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTargetCount(n)}
                  disabled={phase === "generating"}
                  className={`flex-1 rounded-control py-2.5 text-button transition-colors ${
                    targetCount === n
                      ? "bg-accent text-on-accent"
                      : "text-ink-2 hover:bg-surface-3"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={phase === "generating" || !hasSource || !isSignedIn}
            title={isSignedIn ? undefined : "Sign in to generate cards"}
            className="w-full text-button rounded-control bg-accent text-on-accent py-3.5 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {phase === "generating" ? "Generating…" : "Generate cards"}
          </button>
          {!isSignedIn && (
            <p className="text-meta text-ink-3 text-center">
              Sign in to generate cards — the AI runs through your account.
            </p>
          )}
          {phase === "generating" && (
            <p className="text-meta text-ink-3 text-center">
              Asking Claude to draft cards — this can take up to a minute for
              long material.
            </p>
          )}
        </div>
      )}

      {/* Review step */}
      {(phase === "review" || phase === "saving") && (
        <div className="space-y-4">
          {candidates.length === 0 ? (
            <div className="rounded-card border border-line bg-surface-1 p-8 text-center space-y-3">
              <p className="text-meta text-ink-2">
                Claude couldn&apos;t find enough material to draft cards from.
              </p>
              <button
                type="button"
                onClick={startOver}
                className="text-button rounded-control border border-line-2 text-ink-2 px-5 py-2.5 hover:bg-surface-2 transition-colors"
              >
                ← Try different material
              </button>
            </div>
          ) : (
            <>
              <p className="text-meta text-ink-2">
                Review the drafts — edit anything, remove what you don&apos;t
                want, then add them to the deck.
              </p>
              <ul className="space-y-4">
                {candidates.map((c, i) => (
                  <li
                    key={i}
                    className={`rounded-card border bg-surface-1 p-4 space-y-3 ${
                      c.removed ? "border-line opacity-50" : "border-line"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {c.keyPoints.length > 0 && (
                        <span className="text-micro rounded-chip bg-accent-soft text-accent-hi px-2.5 py-1">
                          Concept · {c.keyPoints.length}
                        </span>
                      )}
                      {c.duplicate && (
                        <span className="text-micro rounded-chip bg-incorrect-soft text-incorrect px-2.5 py-1">
                          Duplicate — already in deck
                        </span>
                      )}
                      {c.labels.map((l) => (
                        <span
                          key={l}
                          className="text-micro rounded-chip bg-surface-3 border border-line text-ink-2 px-2.5 py-1"
                        >
                          {l}
                          <button
                            type="button"
                            onClick={() =>
                              updateCandidate(i, {
                                labels: c.labels.filter((x) => x !== l),
                              })
                            }
                            disabled={phase === "saving"}
                            aria-label={`Remove label ${l}`}
                            className="ml-1.5 text-ink-3 hover:text-incorrect"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() => updateCandidate(i, { removed: !c.removed })}
                        disabled={phase === "saving"}
                        className={`ml-auto text-micro transition-colors ${
                          c.removed
                            ? "text-accent-hi hover:opacity-80"
                            : "text-ink-3 hover:text-incorrect"
                        }`}
                      >
                        {c.removed ? "Restore" : "Remove"}
                      </button>
                    </div>

                    {!c.removed && (
                      <>
                        <div className="space-y-1">
                          <label className="text-micro text-ink-3 uppercase tracking-wide">
                            Front
                          </label>
                          <textarea
                            value={c.front}
                            onChange={(e) =>
                              updateCandidate(i, { front: e.target.value })
                            }
                            rows={2}
                            disabled={phase === "saving"}
                            className="w-full rounded-control bg-surface-2 border border-line-2 px-3 py-2 text-meta text-ink-1 focus:outline-none focus:ring-2 focus:ring-accent resize-y disabled:opacity-60"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-micro text-ink-3 uppercase tracking-wide">
                            Back
                          </label>
                          <textarea
                            value={c.back}
                            onChange={(e) =>
                              updateCandidate(i, { back: e.target.value })
                            }
                            rows={3}
                            disabled={phase === "saving"}
                            className="w-full rounded-control bg-surface-2 border border-line-2 px-3 py-2 text-meta text-ink-1 focus:outline-none focus:ring-2 focus:ring-accent resize-y disabled:opacity-60"
                          />
                        </div>
                        {c.alternateAnswers.length > 0 && (
                          <div className="space-y-1">
                            <label className="text-micro text-ink-3 uppercase tracking-wide">
                              Also accepted (one per line)
                            </label>
                            <textarea
                              value={c.alternateAnswers.join("\n")}
                              onChange={(e) =>
                                updateCandidate(i, {
                                  alternateAnswers: e.target.value.split("\n"),
                                })
                              }
                              rows={Math.max(2, c.alternateAnswers.length)}
                              disabled={phase === "saving"}
                              className="w-full rounded-control bg-surface-2 border border-line-2 px-3 py-2 text-meta text-ink-1 focus:outline-none focus:ring-2 focus:ring-accent resize-y disabled:opacity-60"
                            />
                          </div>
                        )}
                        {c.keyPoints.length > 0 && (
                          <div className="space-y-1">
                            <label className="text-micro text-ink-3 uppercase tracking-wide">
                              Key points (one per line — clear all to make it
                              a short-answer card)
                            </label>
                            <textarea
                              value={c.keyPoints.join("\n")}
                              onChange={(e) =>
                                updateCandidate(i, {
                                  keyPoints: e.target.value.split("\n"),
                                })
                              }
                              rows={Math.max(2, c.keyPoints.length)}
                              disabled={phase === "saving"}
                              className="w-full rounded-control bg-surface-2 border border-line-2 px-3 py-2 text-meta text-ink-1 focus:outline-none focus:ring-2 focus:ring-accent resize-y disabled:opacity-60"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>

              <div className="flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => void handleApprove()}
                  disabled={phase === "saving" || kept.length === 0}
                  className="text-button rounded-control bg-accent text-on-accent py-3.5 hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {phase === "saving"
                    ? "Saving…"
                    : `Add ${kept.length} card${kept.length !== 1 ? "s" : ""} to deck`}
                </button>
                <button
                  type="button"
                  onClick={startOver}
                  disabled={phase === "saving"}
                  className="text-button rounded-control border border-line-2 text-ink-2 py-3 hover:bg-surface-2 transition-colors disabled:opacity-50"
                >
                  ← Start over
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Done */}
      {phase === "done" && (
        <div className="rounded-card border border-line bg-surface-1 p-8 text-center space-y-4">
          <p className="text-meta text-ink-1">{summary}</p>
          <div className="flex flex-col gap-2.5">
            <Link
              href={`/decks/${deckId}`}
              className="text-button rounded-control bg-accent text-on-accent py-3 hover:opacity-90 transition-opacity"
            >
              Back to deck
            </Link>
            <button
              type="button"
              onClick={startOver}
              className="text-button rounded-control border border-line-2 text-ink-2 py-3 hover:bg-surface-2 transition-colors"
            >
              Generate more
            </button>
          </div>
        </div>
      )}

      <Link
        href={`/decks/${deckId}`}
        className="inline-block text-meta text-ink-3 hover:text-ink-1 transition-colors"
      >
        ← Back to deck
      </Link>
    </div>
  );
}
