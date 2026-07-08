import {
  authedFetch,
  type AccessTokenGetter,
} from "@/lib/settings/UserClient";
import type { GenerateRequestBody, GenerateResponseBody } from "./wire";

/**
 * Thin wrapper over flashy-api's JWT-guarded POST /generate (same shape as
 * UserClient). Requires sign-in — the Anthropic API key never reaches the
 * client, so generation always round-trips through the backend.
 */
export const GenerateClient = {
  generate(
    getAccessToken: AccessTokenGetter,
    body: GenerateRequestBody,
  ): Promise<GenerateResponseBody> {
    return authedFetch<GenerateResponseBody>(
      "/generate",
      "POST",
      getAccessToken,
      body,
    );
  },
};
