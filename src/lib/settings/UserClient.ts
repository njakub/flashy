import { API_BASE_URL } from "@/lib/config";
import type { ProfileResponseBody, UpdateProfileRequestBody } from "./wire";

/** Same shape as SyncEngine's / LlmGrader's AccessTokenGetter. */
export type AccessTokenGetter = () => Promise<string | null>;

/** Shared JWT-authed JSON fetch against flashy-api — also used by GenerateClient. */
export async function authedFetch<T>(
  path: string,
  method: "GET" | "PATCH" | "POST",
  getAccessToken: AccessTokenGetter,
  body?: unknown,
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Sign in to use this feature.");
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

/** Thin wrapper over flashy-api's guarded /users/me endpoints. */
export const UserClient = {
  getProfile(getAccessToken: AccessTokenGetter): Promise<ProfileResponseBody> {
    return authedFetch<ProfileResponseBody>(
      "/users/me",
      "GET",
      getAccessToken,
    );
  },
  updateProfile(
    getAccessToken: AccessTokenGetter,
    body: UpdateProfileRequestBody,
  ): Promise<ProfileResponseBody> {
    return authedFetch<ProfileResponseBody>(
      "/users/me",
      "PATCH",
      getAccessToken,
      body,
    );
  },
};
