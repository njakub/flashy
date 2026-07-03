"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AuthClient, type AuthUser } from "@/lib/auth/AuthClient";
import { bootstrapLocalUserData } from "@/lib/auth/bootstrap";
import { SyncEngine, type SyncResult } from "@/lib/sync/SyncEngine";
import { onDirty } from "@/lib/sync/dirtyBus";
import { LOCAL_USER_ID } from "@/lib/constants";

const REFRESH_TOKEN_KEY = "flashy_refresh_token";
const SYNC_INTERVAL_MS = 45_000;
const DIRTY_DEBOUNCE_MS = 2_000;

type AuthStatus = "loading" | "signedOut" | "signedIn";

interface Session {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Real user id once signed in, LOCAL_USER_ID otherwise — the seam every
   *  repository call sources ownerId from instead of the hardcoded constant. */
  ownerId: string;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string): Promise<void>;
  loginWithGoogle(idToken: string): Promise<void>;
  logout(): Promise<void>;
  lastSyncAt: string | null;
  syncError: string | null;
  syncing: boolean;
  /** Resolves the current access token, refreshing it first if needed.
   *  Returns null if there's no signed-in session. Used by LlmGrader to
   *  call the guarded POST /grade endpoint, same pattern as SyncEngine. */
  getAccessToken(): Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeJwtExpMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isExpiringSoon(token: string): boolean {
  const expMs = decodeJwtExpMs(token);
  if (expMs === null) return true;
  return expMs - Date.now() < 60_000; // refresh if <60s left
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Lazily seeded from localStorage so the initial render already reflects
  // "no session" without needing a synchronous setState in an effect.
  const [status, setStatus] = useState<AuthStatus>(() =>
    typeof window !== "undefined" && localStorage.getItem(REFRESH_TOKEN_KEY)
      ? "loading"
      : "signedOut",
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Sync loop and getAccessToken both run outside the React render cycle
  // (interval callback), so they read the latest session via a ref rather
  // than closing over stale state.
  const sessionRef = useRef<Session | null>(null);

  const applySession = useCallback((session: Session) => {
    sessionRef.current = session;
    localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
    setUser(session.user);
    setStatus("signedIn");
  }, []);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setUser(null);
    setStatus("signedOut");
  }, []);

  // Plain function, not a useCallback: it only closes over sessionRef
  // (always current) and applySession/clearSession (stable, [] deps), so
  // capturing whichever render's copy into the syncEngineRef singleton
  // below never goes stale.
  async function getAccessToken(): Promise<string | null> {
    const session = sessionRef.current;
    if (session && !isExpiringSoon(session.accessToken)) {
      return session.accessToken;
    }
    const storedRefreshToken =
      session?.refreshToken ?? localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!storedRefreshToken) return null;
    try {
      const tokens = await AuthClient.refresh(storedRefreshToken);
      applySession(tokens);
      return tokens.accessToken;
    } catch {
      clearSession();
      return null;
    }
  }

  // Ref reads/writes only ever happen inside this callback body (executed
  // later, from an effect/interval) — never during the component's
  // synchronous render — so the lazy-init check below is safe.
  const syncEngineRef = useRef<SyncEngine | null>(null);

  // The 45s interval, the post-write debounce, and sign-in/wake-up triggers
  // can all fire close together; without this guard two syncOnce() calls
  // could run concurrently and apply their pulls out of order, interleaving
  // db.syncState cursor writes (a stale cursor could re-pull or skip a
  // revision window). Every trigger below awaits this single in-flight
  // promise instead of starting a second round trip.
  const inFlightRef = useRef<Promise<void> | null>(null);

  const runSync = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    if (!sessionRef.current) return Promise.resolve();
    if (!syncEngineRef.current) {
      syncEngineRef.current = new SyncEngine(getAccessToken);
    }
    setSyncing(true);
    const promise = syncEngineRef.current
      .syncOnce()
      .then((result: SyncResult | null) => {
        if (result) {
          setLastSyncAt(new Date().toISOString());
          setSyncError(null);
        }
      })
      .catch((err: unknown) => {
        setSyncError(err instanceof Error ? err.message : "Sync failed");
      })
      .finally(() => {
        setSyncing(false);
        inFlightRef.current = null;
      });
    inFlightRef.current = promise;
    return promise;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore session from a stored refresh token on first load.
  useEffect(() => {
    const stored = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!stored) return; // initial state already accounts for this case
    AuthClient.refresh(stored)
      .then(async (tokens) => {
        applySession(tokens);
        await bootstrapLocalUserData(tokens.user.id);
      })
      .catch(() => clearSession());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync on sign-in / app open, then periodically while signed in. The
  // initial call is deferred to a microtask so runSync's own setState
  // doesn't execute synchronously inside this effect's call stack.
  //
  // Also resync on `online` (network just came back) and `visibilitychange`
  // (tab/laptop just woke up) rather than waiting up to SYNC_INTERVAL_MS —
  // both are common "device just resumed, UI should converge fast" moments.
  useEffect(() => {
    if (status !== "signedIn") return;
    void Promise.resolve().then(() => runSync());
    const interval = setInterval(() => void runSync(), SYNC_INTERVAL_MS);
    const onOnline = () => void runSync();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [status, runSync]);

  // Sync shortly after any local write, debounced — so "Synced" in the
  // AuthBar reflects the row just created/edited, not only the last
  // periodic tick (up to SYNC_INTERVAL_MS stale otherwise).
  useEffect(() => {
    if (status !== "signedIn") return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = onDirty(() => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void runSync(), DIRTY_DEBOUNCE_MS);
    });
    return () => {
      if (debounce) clearTimeout(debounce);
      unsubscribe();
    };
  }, [status, runSync]);

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await AuthClient.login(email, password);
      applySession(tokens);
      await bootstrapLocalUserData(tokens.user.id);
    },
    [applySession],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const tokens = await AuthClient.register(email, password);
      applySession(tokens);
      await bootstrapLocalUserData(tokens.user.id);
    },
    [applySession],
  );

  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      const tokens = await AuthClient.google(idToken);
      applySession(tokens);
      await bootstrapLocalUserData(tokens.user.id);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    const session = sessionRef.current;
    if (session) {
      await AuthClient.logout(session.refreshToken).catch(() => {});
    }
    clearSession();
  }, [clearSession]);

  const value: AuthContextValue = {
    status,
    user,
    ownerId: user?.id ?? LOCAL_USER_ID,
    login,
    register,
    loginWithGoogle,
    logout,
    lastSyncAt,
    syncError,
    syncing,
    getAccessToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
