import { createTranslator } from "next-intl";

import adminLedgerMessages from "../../../../messages/en-IN/adminLedger.json";
import { LOCALE } from "../../../i18n/formats";

export const postingDescription = createTranslator({
  locale: LOCALE,
  messages: adminLedgerMessages,
  namespace: "adminLedger.postingDescriptions",
});
