import { getFormatter, getTranslations } from "next-intl/server";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { adminArtworkVerifyPath } from "@/lib/app-routes";
import type { ArtworkView } from "@/server/modules/physical-artwork";
import type { custodyUseCases } from "@/server/modules/physical-artwork/custody";
import { DISCREPANCY_REASONS } from "@/server/modules/physical-artwork/domain/custody";
import { custodyAction } from "../_lib/custody-actions";

type Custody = Extract<
  Awaited<ReturnType<ReturnType<typeof custodyUseCases>["getArtworkCustody"]>>,
  { ok: true }
>;
const field =
  "block w-full min-h-12 rounded-xl border-2 border-border-strong bg-surface p-2 text-ink";
export async function CustodyPanel({
  work,
  custody,
  photoLinks,
}: {
  work: ArtworkView;
  custody: Custody;
  photoLinks: { id: string; url: string }[];
}) {
  const [t, artwork, format] = await Promise.all([
    getTranslations("artworkCustody"),
    getTranslations("artwork"),
    getFormatter(),
  ]);
  const { artworkId, artworkCode } = work;
  const { status, mayVerify, mayManage } = custody;
  const here =
    status !== "requested" && status !== "dispatched" && status !== "returned";
  const mayReturn =
    here &&
    (status === "received" ||
      status === "discrepancy" ||
      (status !== "retained" &&
        custody.returnRequest &&
        !custody.returnRequest.fulfilledAt));
  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-3xl border-2 border-border bg-surface p-5">
        <h2 className="text-h3">{t("custody")}</h2>
        <p className="mt-2">
          {t("currentLocation")}: {custody.storageLocation ?? t("unknown")}
        </p>
        {custody.events.length ? (
          <ol className="mt-4 space-y-3">
            {custody.events.map((event) => (
              <li
                key={event.id}
                className="border-l-2 border-border-strong pl-3"
              >
                <span className="font-semibold">
                  {t(`custodyKinds.${event.kind}`)} ·{" "}
                </span>
                <time dateTime={event.at.toISOString()}>
                  {format.dateTime(event.at, "longDateTime")}
                </time>
                {event.location ? <p>{event.location}</p> : null}
                {event.returnVia?.method === "hand_over" ? (
                  <p>
                    {t("handOver")} · {event.returnVia.receivedBy}
                  </p>
                ) : event.returnVia?.method === "courier" ? (
                  <p>
                    {event.returnVia.courierName} ·{" "}
                    {event.returnVia.trackingNumber}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p>{t("noHistory")}</p>
        )}
        {custody.returnWindow ? (
          <p className="mt-4">
            {t("returnWindow", {
              date: format.dateTime(
                custody.returnWindow.closesAt,
                "longDateTime"
              ),
            })}
          </p>
        ) : (
          <p className="mt-4">{t("returnUnavailable")}</p>
        )}
        {custody.returnRequest ? (
          <p className="mt-2 font-semibold">
            {t(
              custody.returnRequest.fulfilledAt
                ? "returnFulfilled"
                : "returnRequested"
            )}
          </p>
        ) : null}
      </section>
      {custody.verification ? (
        <section className="rounded-3xl border-2 border-border bg-surface p-5">
          <h2 className="text-h3">{t("verification")}</h2>
          <dl className="mt-3 space-y-2">
            <div>
              <dt className="font-semibold">{t("condition")}</dt>
              <dd>{t(`conditions.${custody.verification.condition}`)}</dd>
            </div>
            <div>
              <dt className="font-semibold">{t("conditionNotes")}</dt>
              <dd>{custody.verification.conditionNotes ?? t("unknown")}</dd>
            </div>
            <div>
              <dt className="font-semibold">{t("width")}</dt>
              <dd>{custody.verification.widthMm}</dd>
            </div>
            <div>
              <dt className="font-semibold">{t("height")}</dt>
              <dd>{custody.verification.heightMm}</dd>
            </div>
            {custody.verification.depthMm ? (
              <div>
                <dt className="font-semibold">{t("depth")}</dt>
                <dd>{custody.verification.depthMm}</dd>
              </div>
            ) : null}
            <div>
              <dt className="font-semibold">{t("material")}</dt>
              <dd>{custody.verification.material}</dd>
            </div>
          </dl>
          <h3 className="mt-4 text-h4">{t("photos")}</h3>
          <ul className="mt-3 space-y-2">
            {custody.photos
              .filter((photo) => photo.selectedAt)
              .map((photo, index) => {
                const link = photoLinks.find((p) => p.id === photo.id);
                return (
                  <li key={photo.id}>
                    {link ? (
                      <a
                        className="underline text-link"
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("viewPhoto", {
                          kind: t(`photoKinds.${photo.kind}`),
                          number: index + 1,
                        })}
                      </a>
                    ) : (
                      <span>
                        {t(`photoKinds.${photo.kind}`)} ·{" "}
                        {t(`photoStatus.${photo.status}`)}
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ) : null}
      {custody.discrepancies.length > 0 ? (
        <section className="rounded-3xl border-2 border-border bg-surface p-5">
          <h2 className="text-h3">{t("discrepancies")}</h2>
          {custody.discrepancies.map((discrepancy) => (
            <div key={discrepancy.id} className="mt-3">
              <p className="font-semibold">
                {t(discrepancy.resolvedAt ? "resolved" : "open")}
              </p>
              <p className="whitespace-pre-wrap wrap-anywhere">
                {discrepancy.notes}
              </p>
              {discrepancy.resolution ? (
                <p className="whitespace-pre-wrap wrap-anywhere">
                  {discrepancy.resolution}
                </p>
              ) : null}
            </div>
          ))}
          {mayManage && status === "discrepancy" ? (
            <form
              aria-label={t("resolve")}
              className="mt-4 space-y-3"
              action={custodyAction.bind(
                null,
                artworkId,
                artworkCode,
                "resolve"
              )}
            >
              <label htmlFor="resolution">{t("resolution")}</label>
              <textarea
                className={field}
                id="resolution"
                name="resolution"
                required
                maxLength={1000}
                rows={3}
              />
              <button className={buttonStyles()} type="submit">
                {t("resolve")}
              </button>
            </form>
          ) : null}
        </section>
      ) : null}
      {mayVerify && status === "received" ? (
        <section className="rounded-3xl border-2 border-border bg-surface p-5">
          <h2 className="text-h3">{t("verifyTitle")}</h2>
          <ButtonLink
            className="mt-3"
            href={adminArtworkVerifyPath(artworkCode)}
          >
            {t("verify")}
          </ButtonLink>
          <form
            aria-label={t("raise")}
            className="mt-5 space-y-3"
            action={custodyAction.bind(null, artworkId, artworkCode, "raise")}
          >
            <fieldset className="space-y-2">
              <legend className="font-semibold">{t("reason")}</legend>
              {DISCREPANCY_REASONS.map((reason) => (
                <label
                  key={reason}
                  className="flex min-h-11 items-center gap-2"
                >
                  <input type="radio" name="reason" value={reason} required />
                  {t(`reasons.${reason}`)}
                </label>
              ))}
            </fieldset>
            <label htmlFor="discrepancy-notes" className="block">
              {t("notes")}
            </label>
            <textarea
              className={field}
              id="discrepancy-notes"
              name="notes"
              required
              maxLength={1000}
              rows={3}
            />
            <button
              className={buttonStyles({ variant: "secondary" })}
              type="submit"
            >
              {t("raise")}
            </button>
          </form>
        </section>
      ) : null}
      {mayManage && here ? (
        <section className="rounded-3xl border-2 border-border bg-surface p-5 space-y-5">
          <h2 className="text-h3">{t("move")}</h2>
          {(
            [
              "move",
              ...(status === "verified" || status === "retained"
                ? ["exhibit" as const]
                : []),
              ...(status === "on_exhibition" ? ["store" as const] : []),
            ] as const
          ).map((command) => (
            <form
              key={command}
              aria-label={t(command)}
              action={custodyAction.bind(null, artworkId, artworkCode, command)}
              className="space-y-2"
            >
              <label className="block" htmlFor={`location-${command}`}>
                {t(command)} · {t("location")}
              </label>
              <input
                id={`location-${command}`}
                name="location"
                className={field}
                required
                maxLength={120}
              />
              <button
                type="submit"
                className={buttonStyles({ variant: "secondary" })}
              >
                {t(command)}
              </button>
            </form>
          ))}
          {(status === "verified" || status === "on_exhibition") &&
          custody.returnWindow &&
          !custody.returnRequest ? (
            <form
              aria-label={t("retain")}
              action={custodyAction.bind(
                null,
                artworkId,
                artworkCode,
                "retain"
              )}
            >
              <button
                type="submit"
                className={buttonStyles({ variant: "secondary" })}
              >
                {t("retain")}
              </button>
            </form>
          ) : null}
          {mayReturn ? (
            <>
              <h3 className="text-h4">{t("return")}</h3>
              <form
                aria-label={t("handOver")}
                action={custodyAction.bind(
                  null,
                  artworkId,
                  artworkCode,
                  "hand_over"
                )}
                className="space-y-2"
              >
                <label htmlFor="received-by" className="block">
                  {t("recipientName")}
                </label>
                <input
                  id="received-by"
                  name="receivedBy"
                  className={field}
                  required
                  maxLength={120}
                />
                <button
                  className={buttonStyles({ variant: "secondary" })}
                  type="submit"
                >
                  {t("handOver")}
                </button>
              </form>
              <form
                aria-label={t("courier")}
                action={custodyAction.bind(
                  null,
                  artworkId,
                  artworkCode,
                  "courier"
                )}
                className="space-y-2"
              >
                <label htmlFor="return-courier" className="block">
                  {artwork("courier")} ({artwork("required")})
                </label>
                <input
                  id="return-courier"
                  name="courier"
                  className={field}
                  required
                  maxLength={120}
                />
                <label htmlFor="return-tracking" className="block">
                  {artwork("tracking")} ({artwork("required")})
                </label>
                <input
                  id="return-tracking"
                  name="tracking"
                  className={field}
                  required
                  maxLength={120}
                />
                <button
                  className={buttonStyles({ variant: "secondary" })}
                  type="submit"
                >
                  {t("courier")}
                </button>
              </form>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
