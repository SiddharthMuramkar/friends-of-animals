import type { formats, LOCALE } from "@/i18n/formats";
import type { Messages } from "@/i18n/messages";

declare module "next-intl" {
  interface AppConfig {
    Locale: typeof LOCALE;
    Messages: Messages;
    Formats: typeof formats;
  }
}
