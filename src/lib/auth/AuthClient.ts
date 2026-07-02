import { API_BASE_URL } from "@/lib/config";

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text;
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (typeof parsed.message === "string") message = parsed.message;
    } catch {
      // not JSON — use raw text
    }
    throw new Error(message || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Thin wrapper over flashy-api's /auth/* endpoints. */
export const AuthClient = {
  register(email: string, password: string): Promise<AuthTokens> {
    return postJson<AuthTokens>("/auth/register", { email, password });
  },
  login(email: string, password: string): Promise<AuthTokens> {
    return postJson<AuthTokens>("/auth/login", { email, password });
  },
  google(idToken: string): Promise<AuthTokens> {
    return postJson<AuthTokens>("/auth/google", { idToken });
  },
  refresh(refreshToken: string): Promise<AuthTokens> {
    return postJson<AuthTokens>("/auth/refresh", { refreshToken });
  },
  async logout(refreshToken: string): Promise<void> {
    await postJson("/auth/logout", { refreshToken });
  },
};
