import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { Section } from "@/components/site/section";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { IndividualRegistrationForm } from "@/server/modules/participants";

import { RegistrationView } from "./_components/registration-view";

// The individual register form (#78, #81), for a signed-in member: for
// themselves, or with `?child=<id>` for a child they look after. A teen
// whose login is linked, and a child, register with the name and date of
// birth on their profile. It takes a date of birth, phone and address, so
// it sits in the signed-in tree: src/proxy.ts sends visitors to sign in,
// answers an unknown or draft competition with the 404, and gives the page
// the nonce policy. The participant layout waits for the request, so it
// renders at request time.

const HUE = ROUTES.participate.hue;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("participant.register.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = PageProps<"/participant/register/[slug]">;

export default function Page({ params, searchParams }: Props) {
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<Loading />}>
        <Register params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Loading() {
  const t = await getTranslations("participant.register");
  return <p className="text-ink-muted">{t("loading")}</p>;
}

/** The form, or null for a competition there is none for or a child not theirs. */
async function formFor(
  actor: Parameters<typeof as>[0],
  competitionSlug: string,
  forChildId: string | undefined
): Promise<IndividualRegistrationForm | null> {
  try {
    return await as(actor).individualRegistrationForm({
      competitionSlug,
      ...(forChildId === undefined ? {} : { forChildId }),
    });
  } catch (error) {
    // Somebody else's child, or no child at all: not found. Any other
    // refusal (a second factor to pass) goes to the edge as it is.
    if (
      forChildId !== undefined &&
      error instanceof DomainError &&
      error.code === "forbidden"
    ) {
      return null;
    }
    throw error;
  }
}

async function Register({
  params,
  searchParams,
}: {
  params: Props["params"];
  searchParams: Props["searchParams"];
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const childParam =
    typeof query["child"] === "string" ? query["child"] : undefined;
  const form = await formFor(actor, slug, childParam);
  // The proxy has already answered an unknown or draft competition with
  // the 404; this covers one unpublished since, and a child not theirs.
  if (!form) notFound();
  return <RegistrationView form={form} />;
}
