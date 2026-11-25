import { getFormatter, getTranslations } from "next-intl/server";
import { TableScroller } from "@/components/site/table-scroller";
import type { SocialSnapshot } from "@/server/modules/reports/domain/social-snapshot";

const fields = [
  "followers",
  "followerChange",
  "posts",
  "reach",
  "impressions",
  "engagements",
] as const;
const cell = "px-3 py-3 text-right tabular-nums whitespace-nowrap";
export async function SocialTable({
  snapshots,
}: {
  snapshots: SocialSnapshot[];
}) {
  const [t, formatter] = await Promise.all([
    getTranslations("objectiveReports"),
    getFormatter(),
  ]);
  return (
    <section className="mt-8 min-w-0" aria-labelledby="social-report-title">
      <h2 id="social-report-title">{t("categories.social")}</h2>
      <p className="mt-3 max-w-prose text-ink-muted">
        {t("definitions.social")}
      </p>
      {snapshots.length === 0 ? (
        <p className="mt-4">{t("socialEmpty")}</p>
      ) : (
        <TableScroller captionId="social-report-caption" className="mt-4">
          <table className="w-full border-separate border-spacing-0 text-left">
            <caption id="social-report-caption" className="sr-only">
              {t("categories.social")}
            </caption>
            <thead className="bg-surface-muted">
              <tr>
                <th scope="col" className="px-3 py-3 text-left">
                  {t("channel")}
                </th>
                <th scope="col" className="px-3 py-3 text-left">
                  {t("recordedFor")}
                </th>
                {fields.map((field) => (
                  <th scope="col" className={cell} key={field}>
                    {t(`socialFields.${field}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((row) => (
                <tr
                  className="border-t border-border"
                  key={`${row.channel}:${row.recordedFor}`}
                >
                  <th
                    scope="row"
                    className="sticky left-0 border-t border-border bg-surface px-3 py-3 text-left"
                  >
                    {t(`channels.${row.channel}`)}
                  </th>
                  <td className="border-t border-border px-3 py-3 whitespace-nowrap">
                    <time dateTime={row.recordedFor}>{row.recordedFor}</time>
                  </td>
                  {fields.map((field) => (
                    <td
                      className={`${cell} border-t border-border`}
                      key={field}
                    >
                      {row[field] === null ? "—" : formatter.number(row[field])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
    </section>
  );
}
