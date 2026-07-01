"use client";

import { createContext, useContext, type ReactNode } from "react";
import type {
  CardRepository,
  DeckRepository,
} from "@/lib/repositories/interfaces";
import { DexieCardRepository } from "@/lib/repositories/DexieCardRepository";
import { DexieDeckRepository } from "@/lib/repositories/DexieDeckRepository";

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
}

const RepositoryContext = createContext<Repositories | null>(null);

// Singletons — Dexie is already a singleton; these wrappers are stateless.
const cardRepo = new DexieCardRepository();
const deckRepo = new DexieDeckRepository();

export function RepositoryProvider({ children }: { children: ReactNode }) {
  return (
    <RepositoryContext.Provider value={{ cards: cardRepo, decks: deckRepo }}>
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
