"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { useReloadOnSync } from "@/lib/sync/useReloadOnSync";
import { DEFAULT_SCHEDULING_STATE } from "@/lib/scheduler";
import {
  buildExportFile,
  parseImportByFilename,
  sanitizeFilename,
} from "@/lib/importExport";
import { FLAGGED_LABEL } from "@/lib/constants";
import { isConceptCard } from "@/lib/content/concept";
import { previewText } from "@/lib/content/markdown";
import {
  ancestors,
  buildDeckTree,
  flattenTree,
  subtreeIds,
  type DeckNode,
} from "@/lib/decks/tree";
import type { Deck, Card, CardStats } from "@/lib/types";

interface SubtreeCounts {
  decks: number; // descendant decks, excluding this one
  cards: number; // including this deck's own
  due: number;
}

interface Props {
  deckId: string;
}

export function DeckDetail({ deckId }: Props) {
  const { decks, cards, testRuns } = useRepositories();
  const { ownerId, status } = useAuth();
  const isSignedIn = status === "signedIn";
  const router = useRouter();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cardList, setCardList] = useState<Card[]>([]);
  const [allDecks, setAllDecks] = useState<Deck[]>([]);
  const [subtree, setSubtree] = useState<SubtreeCounts>({
    decks: 0,
    cards: 0,
    due: 0,
  });
  // Rolled-up card/due counts per child deck, for the sub-decks list.
  const [childCounts, setChildCounts] = useState<
    Record<string, { cards: number; due: number }>
  >({});
  const [newSubName, setNewSubName] = useState("");
  const [statsMap, setStatsMap] = useState<Map<string, CardStats>>(new Map());
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await decks.getById(deckId);
    if (!d) {
      router.push("/");
      return;
    }
    setDeck(d);
    setEditName(d.name);
    const c = await cards.getByDeck(deckId);
    setCardList(c.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    const now = new Date();

    const everyDeck = await decks.getAll(d.ownerId);
    setAllDecks(everyDeck);
    const ids = subtreeIds(everyDeck, deckId);
    const subtreeCards = await cards.getByDecks(ids);
    const nowIso = now.toISOString();
    const isDue = (x: Card) => x.scheduling.dueAt <= nowIso;
    setSubtree({
      decks: ids.length - 1,
      cards: subtreeCards.length,
      due: subtreeCards.filter(isDue).length,
    });
    const node = flattenTree(buildDeckTree(everyDeck)).find(
      (n) => n.deck.id === deckId,
    );
    const perChild: Record<string, { cards: number; due: number }> = {};
    for (const child of node?.children ?? []) {
      const childIds = new Set(subtreeIds(everyDeck, child.deck.id));
      const inChild = subtreeCards.filter((x) => childIds.has(x.deckId));
      perChild[child.deck.id] = {
        cards: inChild.length,
        due: inChild.filter(isDue).length,
      };
    }
    setChildCounts(perChild);

    // Single grouped pass — O(history size for this deck).
    const statsList = await testRuns.getStatsByCards(c.map((x) => x.id));
    setStatsMap(new Map(statsList.map((s) => [s.cardId, s])));
  }, [deckId, decks, cards, testRuns, router]);

  useReloadOnSync(load);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    const name = editName.trim();
    if (!name || !deck) return;
    setError(null);
    try {
      await decks.update(deck.id, { name });
      setEditing(false);
      await load();
    } catch {
      setError("Failed to rename deck.");
    }
  }

  async function handleAddSubDeck(e: React.FormEvent) {
    e.preventDefault();
    const name = newSubName.trim();
    if (!name || !deck) return;
    setError(null);
    try {
      await decks.create({ name, ownerId, parentId: deck.id });
      setNewSubName("");
      await load();
    } catch {
      setError("Failed to create sub-deck.");
    }
  }

  async function handleMove(parentId: string | null) {
    if (!deck || parentId === deck.parentId) return;
    setError(null);
    try {
      await decks.update(deck.id, { parentId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move deck.");
    }
  }

  async function handleDeleteDeck() {
    if (!deck) return;
    try {
      await decks.delete(deck.id);
      router.push("/");
    } catch {
      setError("Failed to delete deck.");
    }
  }

  async function handleDeleteCard(cardId: string) {
    try {
      await cards.delete(cardId);
      await load();
    } catch {
      setError("Failed to delete card.");
    }
  }

  function handleExport() {
    if (!deck) return;
    const file = buildExportFile(deck.name, cardList);
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(deck.name)}-flashy-export.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    setError(null);
    setImportSummary(null);
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setError(null);
    setImportSummary(null);

    let raw: string;
    try {
      raw = await file.text();
    } catch {
      setError("Failed to read file.");
      return;
    }

    const outcome = parseImportByFilename(file.name, raw);
    if (!outcome.ok) {
      setError(`Import failed: ${outcome.fileError}. No cards were changed.`);
      return;
    }
    const { cards: parsedCards, errors } = outcome.result;

    // Duplicate = matching front text (existing deck cards + earlier rows in
    // this same file), per the "cards shouldn't share front text" rule.
    const existingFronts = new Set(cardList.map((c) => c.front));
    let imported = 0;
    let duplicates = 0;
    for (const pc of parsedCards) {
      if (existingFronts.has(pc.front)) {
        duplicates++;
        continue;
      }
      existingFronts.add(pc.front);
      await cards.create({
        deckId,
        ownerId,
        front: pc.front,
        back: pc.back,
        alternateAnswers: pc.alternateAnswers,
        labels: pc.labels,
        keyPoints: pc.keyPoints,
        scheduling: DEFAULT_SCHEDULING_STATE(),
      });
      imported++;
    }

    await load();

    const parts = [`Imported ${imported} card${imported !== 1 ? "s" : ""}.`];
    if (duplicates > 0) {
      parts.push(
        `Skipped ${duplicates} duplicate${duplicates !== 1 ? "s" : ""} (matching front text).`,
      );
    }
    if (errors.length > 0) {
      const detail = errors
        .map((er) => `row ${er.index + 1} (${er.reason})`)
        .join("; ");
      parts.push(
        `Skipped ${errors.length} invalid entr${errors.length !== 1 ? "ies" : "y"}: ${detail}.`,
      );
    }
    setImportSummary(parts.join(" "));
  }

  if (!deck) return <div className="p-8 text-ink-3">Loading…</div>;

  const totals = Array.from(statsMap.values()).reduce(
    (acc, s) => ({ attempts: acc.attempts + s.attempts, correct: acc.correct + s.correct }),
    { attempts: 0, correct: 0 },
  );
  const avgAccuracy =
    totals.attempts > 0 ? Math.round((totals.correct / totals.attempts) * 100) : null;
  const flaggedCount = cardList.filter((c) =>
    c.labels.includes(FLAGGED_LABEL),
  ).length;
  const tree = buildDeckTree(allDecks);
  const flat = flattenTree(tree);
  const children: DeckNode[] =
    flat.find((n) => n.deck.id === deckId)?.children ?? [];
  const breadcrumb = ancestors(allDecks, deckId);
  // Anywhere outside this deck's own subtree is a valid new parent.
  const excluded = new Set(subtreeIds(allDecks, deckId));
  const moveTargets = flat.filter((n) => !excluded.has(n.deck.id));
  const currentParent = breadcrumb.at(-1)?.id ?? null;
  const visibleCards = showFlaggedOnly
    ? cardList.filter((c) => c.labels.includes(FLAGGED_LABEL))
    : cardList;

  return (
    <div className="w-full max-w-2xl mx-auto py-10 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          {breadcrumb.length > 0 && (
            <nav aria-label="Deck path" className="text-meta text-ink-3 mb-1">
              {breadcrumb.map((a) => (
                <span key={a.id}>
                  <Link
                    href={`/decks/${a.id}`}
                    className="hover:text-accent-hi transition-colors"
                  >
                    {a.name}
                  </Link>
                  {" / "}
                </span>
              ))}
            </nav>
          )}
          {editing ? (
            <form onSubmit={handleRename} className="flex gap-2">
              <input
                autoFocus
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 rounded-control bg-surface-2 border border-line-2 px-4 py-3 text-title focus:outline-none focus:ring-2 focus:ring-accent"
                maxLength={120}
              />
              <button
                type="submit"
                className="text-button rounded-control bg-accent text-on-accent px-5 hover:opacity-90 transition-opacity"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setEditName(deck.name);
                }}
                className="text-button rounded-control border border-line-2 text-ink-2 px-5 hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              <h1 className="text-title tracking-tight">{deck.name}</h1>
              <p className="text-meta text-ink-2 mt-1">
                {cardList.length} card{cardList.length !== 1 ? "s" : ""}
                {subtree.decks > 0 &&
                  ` (${subtree.cards} including sub-decks)`}
                {avgAccuracy !== null && ` · ${avgAccuracy}% average accuracy`}
              </p>
            </>
          )}
        </div>

        {!editing && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setEditing(true)}
              className="text-micro rounded-chip border border-line-2 text-ink-2 px-3 py-1.5 hover:bg-surface-2 transition-colors"
            >
              Rename
            </button>
            <select
              aria-label="Move deck"
              value={currentParent ?? ""}
              onChange={(e) => void handleMove(e.target.value || null)}
              className="text-micro rounded-chip border border-line-2 bg-surface-1 text-ink-2 px-2 py-1.5 max-w-40"
            >
              <option value="">Move to: top level</option>
              {moveTargets.map((n) => (
                <option key={n.deck.id} value={n.deck.id}>
                  {"\u00a0\u00a0".repeat(n.depth)}
                  {n.deck.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-micro rounded-chip border border-incorrect-soft text-incorrect px-3 py-1.5 hover:bg-incorrect-soft transition-colors"
            >
              Delete deck
            </button>
          </div>
        )}
      </div>

      {/* Confirm delete deck */}
      {confirmDelete && (
        <div className="rounded-card border border-incorrect-soft bg-incorrect-soft p-4 space-y-3">
          <p className="text-meta text-incorrect font-semibold">
            Delete &ldquo;{deck.name}&rdquo;
            {subtree.decks > 0 &&
              `, its ${subtree.decks} sub-deck${subtree.decks !== 1 ? "s" : ""}`}{" "}
            and all {subtree.cards} card{subtree.cards !== 1 ? "s" : ""} with
            their test history? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDeleteDeck}
              className="text-button rounded-control bg-incorrect text-on-accent px-5 hover:opacity-90 transition-opacity"
            >
              Yes, delete everything
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-button rounded-control border border-line-2 text-ink-2 px-5 hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-meta text-incorrect">{error}</p>}
      {importSummary && <p className="text-meta text-ink-2">{importSummary}</p>}

      {/* Study / Test actions */}
      <div className="flex gap-2">
        <Link
          href={`/decks/${deckId}/study`}
          className="flex-[1.5] text-center text-button rounded-control bg-accent text-on-accent px-4 py-3 hover:opacity-90 transition-opacity"
        >
          Study · {subtree.due} due
        </Link>
        <Link
          href={`/decks/${deckId}/test`}
          className="flex-1 text-center text-button rounded-control bg-surface-3 border border-line-2 text-ink-1 px-4 py-3 hover:border-accent transition-colors"
        >
          Test
        </Link>
        <Link
          href={`/decks/${deckId}/history`}
          className="flex-1 text-center text-button rounded-control bg-surface-3 border border-line-2 text-ink-1 px-4 py-3 hover:border-accent transition-colors"
        >
          History
        </Link>
      </div>

      {/* Sub-decks */}
      <div className="space-y-2">
        <span className="text-micro text-ink-3 uppercase tracking-wide">
          Sub-decks
        </span>
        {children.length > 0 && (
          <ul className="flex flex-col gap-2">
            {children.map((child) => {
              const c = childCounts[child.deck.id] ?? { cards: 0, due: 0 };
              return (
                <li key={child.deck.id}>
                  <Link
                    href={`/decks/${child.deck.id}`}
                    className="flex items-center justify-between gap-4 rounded-row bg-surface-1 border border-line px-4 py-3 hover:border-accent transition-colors"
                  >
                    <span className="text-body text-ink-1 truncate">
                      {child.deck.name}
                    </span>
                    <span className="text-meta text-ink-3 shrink-0">
                      {c.cards} card{c.cards !== 1 ? "s" : ""}
                      {c.due > 0 && ` · ${c.due} due`}
                      {child.children.length > 0 &&
                        ` · ${child.children.length} sub-deck${child.children.length !== 1 ? "s" : ""}`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <form onSubmit={handleAddSubDeck} className="flex gap-2">
          <input
            type="text"
            value={newSubName}
            onChange={(e) => setNewSubName(e.target.value)}
            placeholder="New sub-deck name…"
            maxLength={120}
            className="flex-1 rounded-control bg-surface-2 border border-line-2 px-4 py-2 text-base text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={!newSubName.trim()}
            className="text-micro rounded-chip bg-accent-soft text-accent-hi px-3 py-1.5 hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            + Add sub-deck
          </button>
        </form>
      </div>

      {/* Import / export */}
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={cardList.length === 0}
            className="text-micro rounded-chip border border-line text-ink-2 px-3 py-1.5 hover:bg-surface-2 transition-colors disabled:opacity-50"
          >
            Export cards
          </button>
          <button
            onClick={handleImportClick}
            title="JSON export, CSV (front,back,alternates,labels), or plain text (front | back, one per line)"
            className="text-micro rounded-chip border border-line text-ink-2 px-3 py-1.5 hover:bg-surface-2 transition-colors"
          >
            Import cards
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json,.csv,text/csv,.txt,text/plain"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            onClick={() => router.push(`/decks/${deckId}/cards/generate`)}
            disabled={!isSignedIn}
            title={
              isSignedIn
                ? "Generate flashcards from pasted text, a document, or a PDF"
                : "Sign in to generate cards"
            }
            className="text-micro rounded-chip border border-line text-accent-hi px-3 py-1.5 hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            ✨ Generate with AI
          </button>
        </div>
        <p className="text-micro text-ink-3">
          Import formats: JSON export, CSV
          (front,back,alternates,labels,keypoints — &ldquo;;&rdquo; separates
          multiple alternates/labels/keypoints), or plain text (one card per
          line, front | back).
        </p>
      </div>

      {/* Add card */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-micro text-ink-3 uppercase tracking-wide">
            Cards
          </span>
          {flaggedCount > 0 && (
            <button
              onClick={() => setShowFlaggedOnly((v) => !v)}
              className={`text-micro rounded-chip border px-2.5 py-1 transition-colors ${
                showFlaggedOnly
                  ? "bg-incorrect text-on-semantic border-incorrect"
                  : "bg-surface-2 border-line-2 text-ink-2 hover:bg-surface-3"
              }`}
            >
              ⚑ {flaggedCount} flagged
            </button>
          )}
        </div>
        <Link
          href={`/decks/${deckId}/cards/new`}
          className="text-micro rounded-chip bg-accent-soft text-accent-hi px-3 py-1.5 hover:opacity-80 transition-opacity"
        >
          + Add card
        </Link>
      </div>

      {/* Card list */}
      {visibleCards.length === 0 ? (
        <p className="text-meta text-ink-3">
          {cardList.length === 0
            ? "No cards yet."
            : "No flagged cards."}
        </p>
      ) : (
        <ul className="flex flex-col">
          {visibleCards.map((card) => {
            const s = statsMap.get(card.id);
            const pct =
              s && s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : null;
            const pctColor =
              pct === null
                ? "text-ink-3"
                : pct >= 80
                  ? "text-correct"
                  : pct >= 60
                    ? "text-self-grade"
                    : "text-incorrect";
            const barColor =
              pct === null
                ? "bg-line-2"
                : pct >= 80
                  ? "bg-correct"
                  : pct >= 60
                    ? "bg-self-grade"
                    : "bg-incorrect";
            return (
              <li
                key={card.id}
                className="py-4 border-b border-line last:border-none flex items-start gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-body text-ink-1 truncate">
                    {previewText(card.front)}
                  </p>
                  {(isConceptCard(card) || (card.labels ?? []).length > 0) && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {isConceptCard(card) && (
                        <span className="text-micro rounded-chip bg-accent-soft text-accent-hi px-2.5 py-1">
                          Concept · {(card.keyPoints ?? []).length}
                        </span>
                      )}
                      {(card.labels ?? []).map((l) => (
                        <span
                          key={l}
                          className={
                            l === FLAGGED_LABEL
                              ? "text-micro rounded-chip bg-incorrect-soft border border-incorrect-soft text-incorrect px-2.5 py-1"
                              : "text-micro rounded-chip bg-surface-3 border border-line text-ink-2 px-2.5 py-1"
                          }
                        >
                          {l === FLAGGED_LABEL ? `⚑ ${l}` : l}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-none flex flex-col items-end gap-0.5">
                  <span className={`text-stat ${pctColor}`}>
                    {pct === null ? "—" : `${pct}%`}
                  </span>
                  <span className="text-stat text-ink-3">
                    {s?.attempts ?? 0} tries
                  </span>
                  <div className="w-12 h-1 rounded-pill bg-surface-2 overflow-hidden mt-0.5">
                    <div
                      className={`h-full rounded-pill ${barColor}`}
                      style={{ width: pct === null ? "0%" : `${pct}%` }}
                    />
                  </div>
                  <div className="flex gap-2 mt-1">
                    <Link
                      href={`/decks/${deckId}/cards/${card.id}/edit`}
                      className="text-micro text-ink-3 hover:text-accent-hi transition-colors"
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => handleDeleteCard(card.id)}
                      className="text-micro text-ink-3 hover:text-incorrect transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Link
        href="/"
        className="inline-block text-meta text-ink-3 hover:text-ink-1 transition-colors"
      >
        ← All decks
      </Link>
    </div>
  );
}
