import { db } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/constants";

/**
 * One-time-per-device migration: on first sign-in, re-stamp any pre-existing
 * LOCAL_USER_ID-owned rows to the real authenticated user's id and mark them
 * dirty so they push on the next sync. Safe to call on every sign-in/session
 * restore — idempotent, since after the first run there are no LOCAL_USER_ID
 * rows left to find. Rows created before auth existed are always dirty
 * already (there was never a token to sync them with), so this only needs
 * to fix ownerId, not dirty state.
 */
export async function bootstrapLocalUserData(realUserId: string): Promise<void> {
  if (realUserId === LOCAL_USER_ID) return;

  await db.transaction("rw", db.decks, db.cards, db.testRuns, async () => {
    await db.decks
      .where("ownerId")
      .equals(LOCAL_USER_ID)
      .modify({ ownerId: realUserId, dirty: 1 });
    await db.cards
      .where("ownerId")
      .equals(LOCAL_USER_ID)
      .modify({ ownerId: realUserId, dirty: 1 });
    await db.testRuns
      .where("ownerId")
      .equals(LOCAL_USER_ID)
      .modify({ ownerId: realUserId, dirty: 1 });
  });
}
