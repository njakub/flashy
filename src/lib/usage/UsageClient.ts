import { authedFetch, type AccessTokenGetter } from "@/lib/settings/UserClient";
import type {
  RecommendationsResponseBody,
  UsageRange,
  UsageSummaryResponseBody,
} from "./wire";

/** Thin wrapper over flashy-api's guarded /usage/* endpoints. */
export const UsageClient = {
  getSummary(
    getAccessToken: AccessTokenGetter,
    range: UsageRange,
  ): Promise<UsageSummaryResponseBody> {
    return authedFetch<UsageSummaryResponseBody>(
      `/usage/summary?range=${range}`,
      "GET",
      getAccessToken,
    );
  },
  getRecommendations(
    getAccessToken: AccessTokenGetter,
  ): Promise<RecommendationsResponseBody> {
    return authedFetch<RecommendationsResponseBody>(
      "/usage/recommendations",
      "GET",
      getAccessToken,
    );
  },
};
