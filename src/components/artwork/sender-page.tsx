import { getTranslations, getFormatter } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { buttonStyles } from "@/components/site/button-link";
import { as, currentActor } from "@/server/app";
import { ArtworkFacts } from "./artwork-facts";
import { dispatchArtwork, requestReturn } from "./sender-action";
export async function SenderPage({
  route,
  result,
}: {
  route: "institution" | "individual";
  result: string | string[] | undefined;
}) {
  await connection();
  const [actor, t, custody, format] = await Promise.all([
    currentActor(),
    getTranslations("artwork"),
    getTranslations("artworkCustody"),
    getFormatter(),
  ]);
  if (actor.kind !== "user") redirect("/sign-in");
  const list = await as(actor).listMyArtworks();
  const works = list.artworks.filter((w) =>
    route === "institution" ? w.institutionSender : w.familySender
  );
  return (
    <Section width="wide" hue="green" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("senderLead")} />
      {result ? (
        <output className="block mt-4">
          {t(result === "ok" ? "success" : "failure")}
        </output>
      ) : null}
      {works.length === 0 ? (
        <p className="mt-6">{t("empty")}</p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {works.map((w) => (
            <li
              key={w.artworkId}
              className="rounded-3xl border-2 border-border bg-surface p-5 text-ink"
            >
              <h2 className="text-h4" id={`artwork-${w.artworkId}`}>
                {w.artworkCode}
              </h2>
              <ArtworkFacts work={w} />
              {w.status === "requested" &&
              (route === "institution" || !w.institutionRegistrationId) ? (
                <form
                  aria-labelledby={`artwork-${w.artworkId}`}
                  action={dispatchArtwork.bind(null, route, w.artworkId)}
                  className="mt-5 space-y-3"
                >
                  <label className="block" htmlFor={`courier-${w.artworkId}`}>
                    {t("courier")} ({t("required")})
                  </label>
                  <input
                    className="block w-full rounded-xl border-2 border-border-strong bg-surface p-2"
                    id={`courier-${w.artworkId}`}
                    name="courier"
                    required
                    maxLength={60}
                  />
                  <label className="block" htmlFor={`tracking-${w.artworkId}`}>
                    {t("tracking")} ({t("required")})
                  </label>
                  <input
                    className="block w-full rounded-xl border-2 border-border-strong bg-surface p-2"
                    id={`tracking-${w.artworkId}`}
                    name="tracking"
                    required
                    maxLength={60}
                  />
                  <button type="submit" className={buttonStyles()}>
                    {t("dispatch")}
                  </button>
                </form>
              ) : null}
              {w.returnRequested ? (
                <p className="mt-4 font-semibold">
                  {custody("returnRequested")}
                </p>
              ) : w.mayRequestReturn && w.returnWindow ? (
                <form
                  aria-label={custody("requestReturn")}
                  className="mt-4 space-y-3"
                  action={requestReturn.bind(null, route, w.artworkId)}
                >
                  <p>
                    {custody("returnWindow", {
                      date: format.dateTime(
                        w.returnWindow.closesAt,
                        "longDateTime"
                      ),
                    })}
                  </p>
                  <p>{custody("requestReturnHelp")}</p>
                  <button type="submit" className={buttonStyles()}>
                    {custody("requestReturn")}
                  </button>
                </form>
              ) : w.returnWindow &&
                (w.status === "retained" ||
                  w.status === "verified" ||
                  w.status === "on_exhibition") ? (
                <p className="mt-4">
                  {custody("returnWindow", {
                    date: format.dateTime(
                      w.returnWindow.closesAt,
                      "longDateTime"
                    ),
                  })}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
