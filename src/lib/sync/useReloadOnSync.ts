import { useEffect } from "react";
import { onSyncApplied } from "./syncEvents";

/**
 * Runs `load` once on mount, then again every time a background sync pulls
 * new rows into Dexie — so a page showing synced data (deck list, card
 * list, test history) picks up changes from another device without
 * needing a manual refresh. Skipped by StudySession/TestSession
 * deliberately: re-fetching the due-card queue mid-session would yank
 * cards out from under an in-progress review.
 */
export function useReloadOnSync(load: () => void): void {
  useEffect(() => {
    load();
    return onSyncApplied(load);
  }, [load]);
}
