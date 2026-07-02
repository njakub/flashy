/**
 * Fired by SyncEngine after it applies pulled rows to Dexie. SyncEngine
 * writes db.cards/db.decks/db.testRuns/db.testRunQuestions directly — it
 * has no way to tell React anything changed. Components that display
 * synced data subscribe via useReloadOnSync to re-fetch when this fires,
 * otherwise data pulled from another device (or from this device's own
 * background sync) sits correctly in Dexie but never appears on screen
 * until an unrelated re-render happens to run their loader again.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function notifySyncApplied(): void {
  for (const l of listeners) l();
}

export function onSyncApplied(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
