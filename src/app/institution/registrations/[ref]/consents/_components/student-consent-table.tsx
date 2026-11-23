import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";

import { Chip } from "@/components/site/chip";
import { TableScroller } from "@/components/site/table-scroller";
import { messages } from "@/i18n/messages";
import type { StudentConsents } from "@/server/modules/consent-links/dashboard";

import { LinkControls } from "./link-controls";

const CELL = "px-4 py-3 text-start align-top";

export async function StudentConsentTable({ list }: { list: StudentConsents }) {
  const t = await getTranslations("coordinatorConsents");
  return (
    <NextIntlClientProvider
      messages={{
        coordinatorConsents: messages.coordinatorConsents,
        common: { callout: messages.common.callout },
      }}
    >
      <TableScroller captionId="consent-table-caption">
        <table className="w-full border-collapse text-ink">
          <caption id="consent-table-caption" className="sr-only">
            {t("caption")}
          </caption>
          <thead className="bg-surface-muted">
            <tr>
              <th scope="col" className={CELL}>
                {t("student")}
              </th>
              <th scope="col" className={CELL}>
                {t("codeLink")}
              </th>
              <th scope="col" className={CELL}>
                {t("publicUses")}
              </th>
              <th scope="col" className={CELL}>
                {t("actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.students.map((student) => (
              <tr key={student.studentId}>
                <th scope="row" className={CELL}>
                  {student.name}
                </th>
                <td className={CELL}>
                  <Chip
                    tone={student.link === "answered" ? "green" : "neutral"}
                  >
                    {t(`links.${student.link}`)}
                  </Chip>
                </td>
                <td className={CELL}>
                  <p className="font-semibold">
                    {t(`summary.${student.publicUse}`)}
                  </p>
                  {student.given.length > 0 ? (
                    <ul className="mt-2 list-disc ps-4 text-sm">
                      {student.given.map((purpose) => (
                        <li key={purpose}>{t(`uses.${purpose}`)}</li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td className={CELL}>
                  <LinkControls
                    registrationId={list.registrationId}
                    studentId={student.studentId}
                    name={student.name}
                    canSend={student.canSendLink}
                    replaces={
                      student.link === "sent" || student.link === "opened"
                    }
                    smsEnabled={list.smsEnabled}
                    revocableLinkId={student.revocableLinkId}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
    </NextIntlClientProvider>
  );
}
