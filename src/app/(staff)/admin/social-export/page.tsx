import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { as, currentActor } from "@/server/app";
import { APP_ROUTES } from "@/lib/app-routes";
import { adminCall } from "../_lib/boundary";
import { AdminDenied } from "../_components/admin-denied";
import { socialExportAction } from "./actions";

export const instant = false;
export const metadata = {
  title: "Social media export",
  robots: { index: false, follow: false },
};
const creditText = (credit: { name: string; school?: string; city?: string }) =>
  [credit.name, credit.school, credit.city].filter(Boolean).join(" · ");
const card = "min-w-0 rounded-2xl border-2 border-border bg-surface p-5";
const grid = "mt-4 grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-2";
export default async function Page({
  searchParams,
}: PageProps<"/admin/social-export">) {
  const [actor, t, query] = await Promise.all([
    currentActor(),
    getTranslations("socialExport"),
    searchParams,
  ]);
  const loaded = await adminCall(
    () =>
      Promise.all([
        as(actor).listSocialExports(),
        as(actor).listSocialExportCandidates(),
      ]),
    APP_ROUTES.adminSocialExport
  );
  return (
    <Section width="wide" hue="pink" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("lead")} />
      {!loaded.ok ? (
        <AdminDenied />
      ) : (
        <>
          <ButtonLink href={APP_ROUTES.adminGallery} className="mt-5">
            {t("gallery")}
          </ButtonLink>
          {query.result ? (
            <output className="block mt-4 text-ink">
              {t(query.result === "ok" ? "saved" : "error")}
            </output>
          ) : null}
          <h2 className="mt-8 text-h3 text-ink">{t("queue")}</h2>
          {!loaded.value[0].length ? (
            <p className="mt-4">{t("queueEmpty")}</p>
          ) : null}
          <ul className={grid}>
            {loaded.value[0].map((item) => {
              const url = `/api/admin/social-export/${item.exportId}`;
              return (
                <li className={card} key={item.exportId}>
                  <h3 className="text-h4 text-ink wrap-anywhere">
                    {item.title}
                  </h3>
                  <p className="mt-2 font-semibold text-ink">
                    {t(`status.${item.status}`)}
                  </p>
                  <p className="mt-2 wrap-anywhere">
                    {t("credit", { name: creditText(item.credit) })}
                  </p>
                  {item.sampleIllustration ? (
                    <p className="mt-2 text-sm text-ink-muted">{t("sample")}</p>
                  ) : null}
                  {item.status === "pending" ? (
                    <form
                      action={socialExportAction.bind(
                        null,
                        "edit",
                        item.exportId
                      )}
                      className="mt-4 grid gap-3"
                    >
                      <label
                        htmlFor={`caption-${item.exportId}`}
                        className="font-semibold"
                      >
                        {t("captionLabel")}
                      </label>
                      <p
                        id={`hint-${item.exportId}`}
                        className="text-sm text-ink-muted"
                      >
                        {t("captionHint")}
                      </p>
                      <textarea
                        id={`caption-${item.exportId}`}
                        aria-describedby={`hint-${item.exportId}`}
                        name="caption"
                        required
                        defaultValue={item.caption}
                        rows={5}
                        maxLength={2200}
                        className="min-h-12 min-w-0 w-full rounded-xl border-2 border-border-strong bg-background p-3 text-ink"
                      />
                      <button
                        type="submit"
                        className={buttonStyles({ variant: "secondary" })}
                      >
                        {t("saveCaption")}
                      </button>
                    </form>
                  ) : (
                    <p className="mt-4 whitespace-pre-wrap wrap-anywhere">
                      {item.caption}
                    </p>
                  )}
                  {item.stampReady ? (
                    <div className="mt-4 flex flex-wrap gap-3">
                      <a className={buttonStyles()} href={`${url}/image`}>
                        {t("imageDownload")}
                      </a>
                      <a
                        className={buttonStyles({ variant: "secondary" })}
                        href={`${url}/caption`}
                      >
                        {t("captionDownload")}
                      </a>
                    </div>
                  ) : (
                    <>
                      <p className="mt-4">{t("stampPending")}</p>
                      <form
                        action={socialExportAction.bind(
                          null,
                          "retry",
                          item.exportId
                        )}
                        className="mt-3"
                      >
                        <button
                          className={buttonStyles({ variant: "secondary" })}
                        >
                          {t("retry")}
                        </button>
                      </form>
                    </>
                  )}
                  {item.status === "pending" && item.stampReady ? (
                    <form
                      className="mt-4"
                      action={socialExportAction.bind(
                        null,
                        "post",
                        item.exportId
                      )}
                    >
                      <button
                        className={buttonStyles({ variant: "secondary" })}
                      >
                        {t("markPosted")}
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <h2 className="mt-8 text-h3 text-ink">{t("candidates")}</h2>
          {!loaded.value[1].length ? (
            <p className="mt-4">{t("candidateEmpty")}</p>
          ) : null}
          <ul className={grid}>
            {loaded.value[1].map((item) => (
              <li className={card} key={item.itemId}>
                <h3 className="text-h4 text-ink wrap-anywhere">{item.title}</h3>
                <p className="mt-2 wrap-anywhere">
                  {t("credit", { name: creditText(item.credit) })}
                </p>
                {item.sampleIllustration ? (
                  <p className="mt-2 text-sm text-ink-muted">{t("sample")}</p>
                ) : null}
                <form
                  className="mt-4"
                  action={socialExportAction.bind(null, "queue", item.itemId)}
                >
                  <button className={buttonStyles()}>{t("queueItem")}</button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
