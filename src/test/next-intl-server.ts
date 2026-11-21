import { createFormatter, createTranslator } from "next-intl";

import { formats, LOCALE, TIME_ZONE } from "@/i18n/formats";
import { messages } from "@/i18n/messages";

// Stand-in for next-intl/server under Vitest:
//   vi.mock("next-intl/server", () => import("@/test/next-intl-server"));
// The real module reads the request config that Next.js wires in at build
// time. This one translates with the same en-IN messages and formats.

export async function getTranslations(namespace?: string) {
  return createTranslator({
    locale: LOCALE,
    timeZone: TIME_ZONE,
    formats,
    messages,
    namespace: namespace as never,
  });
}

export async function getFormatter() {
  return createFormatter({ locale: LOCALE, timeZone: TIME_ZONE, formats });
}
