import { getRequestConfig } from "next-intl/server";

import { formats, LOCALE, TIME_ZONE } from "./formats";
import { messages } from "./messages";

// next-intl without i18n routing (tech-recipes §3.15): one locale, no
// [locale] segment, nothing read from the request, so pages stay static.
// hi-IN later moves to a [locale] root segment.
export default getRequestConfig(async () => ({
  locale: LOCALE,
  timeZone: TIME_ZONE,
  formats,
  messages,
  // No `now`: reading the clock while prerendering is a Cache Components error.
}));
