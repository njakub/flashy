"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/components/providers/AuthProvider";

export function AuthBar() {
  const { status, user, logout, syncing, syncError, lastSyncAt } = useAuth();

  if (status === "loading") return null;

  return (
    <div className="w-full border-b border-line bg-surface-1 px-4 py-2 flex items-center gap-3 text-meta text-ink-3">
      <Link href="/" className="flex items-center gap-2 mr-auto">
        <Image src="/logo.png" alt="Flashy" width={28} height={28} priority />
        <span className="font-semibold text-ink-1 text-sm">Flashy</span>
      </Link>
      {status === "signedOut" ? (
        <Link href="/login" className="text-accent-hi hover:underline">
          Sign in for cross-device sync
        </Link>
      ) : (
        <>
          <span title={lastSyncAt ?? undefined}>
            {syncing
              ? "Syncing…"
              : syncError
                ? `Sync error: ${syncError}`
                : "Synced"}
          </span>
          <Link href="/profile" className="text-accent-hi hover:underline">
            Profile
          </Link>
          <span className="text-ink-3">{user?.email}</span>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-accent-hi hover:underline"
          >
            Sign out
          </button>
        </>
      )}
    </div>
  );
}
