import { getTranslations } from "next-intl/server";

import messages from "../../../../../../messages/en-IN/adminBreaches.json";

type ErrorCode = keyof typeof messages.adminBreaches.errors;
type ResultCode = keyof typeof messages.adminBreaches.results;

export type BreachOutcome =
  | { error: ErrorCode }
  | { done: Exclude<ResultCode, "notices" | "unmatched"> }
  | { done: "notices"; queued: number; unmatched: number };

export function outcomeHref(path: string, outcome: BreachOutcome): string {
  const query = new URLSearchParams({
    done: "error" in outcome ? outcome.error : outcome.done,
  });
  if ("queued" in outcome) {
    query.set("n", `${outcome.queued},${outcome.unmatched}`);
  }
  return `${path}?${query.toString()}`;
}

export async function breachNotice({
  done,
  n,
}: Record<string, string | string[] | undefined>) {
  if (typeof done !== "string") return null;
  const t = await getTranslations("adminBreaches");
  if (Object.hasOwn(messages.adminBreaches.errors, done)) {
    return {
      tone: "danger" as const,
      message: t(`errors.${done as ErrorCode}`),
    };
  }
  if (done === "notices") {
    if (typeof n !== "string" || !/^\d{1,5},\d{1,5}$/.test(n)) return null;
    const [queued = 0, unmatched = 0] = n.split(",").map(Number);
    return {
      tone: "success" as const,
      message: [
        t("results.notices", { count: queued }),
        unmatched ? t("results.unmatched", { count: unmatched }) : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  if (
    !Object.hasOwn(messages.adminBreaches.results, done) ||
    done === "unmatched"
  ) {
    return null;
  }
  return {
    tone: "success" as const,
    message: t(`results.${done as ResultCode}`),
  };
}
