"use client";

import { createContext, useContext, type ReactNode } from "react";
import type {
  CardRepository,
  DeckRepository,
  TestRunRepository,
} from "@/lib/repositories/interfaces";
import { DexieCardRepository } from "@/lib/repositories/DexieCardRepository";
import { DexieDeckRepository } from "@/lib/repositories/DexieDeckRepository";
import { DexieTestRunRepository } from "@/lib/repositories/DexieTestRunRepository";

/**
 * RepositoryContext — Phase 2 seam.
 *
 * Components obtain repositories through this context, never by constructing
 * concrete implementations directly. In Phase 2, swap the implementations
 * here (e.g. HybridCardRepository that syncs to a server) without touching
 * any component.
 */
interface Repositories {
  cards: CardRepository;
  decks: DeckRepository;
  testRuns: TestRunRepository;
}

const RepositoryContext = createContext<Repositories | null>(null);

// Singletons — Dexie is already a singleton; these wrappers are stateless.
const cardRepo = new DexieCardRepository();
const deckRepo = new DexieDeckRepository();
const testRunRepo = new DexieTestRunRepository();

export function RepositoryProvider({ children }: { children: ReactNode }) {
  return (
    <RepositoryContext.Provider
      value={{ cards: cardRepo, decks: deckRepo, testRuns: testRunRepo }}
    >
      {children}
    </RepositoryContext.Provider>
  );
}

export function useRepositories(): Repositories {
  const ctx = useContext(RepositoryContext);
  if (!ctx)
    throw new Error("useRepositories must be used inside RepositoryProvider");
  return ctx;
}
