import { getTranslations } from "next-intl/server";

import { Chip } from "@/components/site/chip";
import { TableScroller } from "@/components/site/table-scroller";
import type { StudentConsents } from "@/server/modules/consent-links/dashboard";

import { LinkControls } from "./link-controls";

const CELL = "px-4 py-3 text-start align-top";

export async function StudentConsentTable({ list }: { list: StudentConsents }) {
  const [t, callout] = await Promise.all([
    getTranslations("coordinatorConsents"),
    getTranslations("common.callout"),
  ]);
  const controlLabels = {
    revoke: t("revoke"),
    revoking: t("revoking"),
    sentNotice: t("sentNotice"),
    revokedNotice: t("revokedNotice"),
    loadingContact: t("loadingContact"),
    cancel: t("cancel"),
    form: {
      title: t("sendTitle"),
      channel: t("channel"),
      methods: { email: t("email"), sms: t("sms") },
      addresses: { email: t("emailAddress"), sms: t("phoneNumber") },
      submit: t("send"),
      pending: t("sending"),
      danger: callout("danger"),
    },
  };
  return (
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
          {list.students.map((student) => {
            const replaces =
              student.link === "sent" ||
              student.link === "opened" ||
              student.link === "verified";
            return (
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
                    institutionId={list.institutionId}
                    registrationId={list.registrationId}
                    studentId={student.studentId}
                    canSend={student.canSendLink}
                    smsEnabled={list.smsEnabled}
                    revocableLinkId={student.revocableLinkId}
                    labels={{
                      ...controlLabels,
                      send: t(replaces ? "replace" : "send"),
                      dialogTitle: t(replaces ? "replaceTitle" : "sendTitle"),
                      dialogHint: t(replaces ? "replaceHint" : "sendHint", {
                        student: student.name,
                      }),
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}
