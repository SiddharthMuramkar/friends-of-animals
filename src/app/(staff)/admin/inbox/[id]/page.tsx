import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { CONTACT_NOTE_MAX } from "@/server/modules/contact/domain/limits";
import { CONTACT_CLOSE_REASONS } from "@/server/modules/contact/domain/status";

import { secondStepRedirect } from "../_lib/form-state";
import { unlessRefused } from "../_lib/refusal";
import { STATUS_TONE } from "../_lib/status-tone";
import { AssignForm, NoteForm, StatusForm } from "./_components/message-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminInbox.detail.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Params = PageProps<"/admin/inbox/[id]">["params"];

export default async function Page({ params }: PageProps<"/admin/inbox/[id]">) {
  const t = await getTranslations("adminInbox");
  return (
    <Section hue="teal" tone="tint" width="prose" className="pt-10 sm:pt-14">
      {/* The id and the message are request data: both stream in. */}
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Message params={params} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
const LINK =
  "text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/** A term and its value in a details list. */
function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="font-semibold text-ink sm:w-48 sm:shrink-0">{term}</dt>
      <dd className="text-ink wrap-anywhere">{children}</dd>
    </div>
  );
}

async function Message({ params }: { params: Params }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { id } = await params;
  const [t, tc, topics, format, loaded] = await Promise.all([
    getTranslations("adminInbox"),
    getTranslations("common.callout"),
    getTranslations("contact.topics.items"),
    getFormatter(),
    unlessRefused(() => as(actor).getContactMessage({ messageId: id })),
  ]);
  if (!loaded.ok) {
    // Staff short of their second step enter it, then come back (#60).
    const lift = secondStepRedirect(loaded.refusal, id);
    if (lift) redirect(lift);
  }
  const denied = !loaded.ok;

  if (!loaded.ok || !loaded.value.ok) {
    return (
      <>
        <PageHeader eyebrow={t("eyebrow")} tile="teal" title={t("title")} />
        <ExplainState
          title={denied ? t("denied.title") : t("detail.notFound")}
          back={
            denied
              ? { href: ROUTES.home.path, label: t("denied.back") }
              : { href: APP_ROUTES.adminInbox, label: t("detail.back") }
          }
          className="mt-8"
        >
          {denied ? <p>{t("denied.body")}</p> : null}
        </ExplainState>
      </>
    );
  }

  const { message } = loaded.value;
  const when = (date: Date) => format.dateTime(date, "longDateTime");
  const callout = { problem: tc("danger"), done: tc("success") };

  return (
    <>
      <PageHeader
        eyebrow={t("title")}
        tile="teal"
        title={message.subject}
        lead={t("list.from", { name: message.name })}
      />
      <div className="mt-6">
        <ButtonLink href={APP_ROUTES.adminInbox} variant="secondary">
          {t("detail.back")}
        </ButtonLink>
      </div>

      <div className="mt-10 flex flex-col gap-8">
        <section aria-labelledby="message-details" className={CARD}>
          <SectionHeading id="message-details" title={t("detail.details")} />
          <dl className="mt-4 flex flex-col gap-3">
            <Detail term={t("detail.reference")}>
              <span className="font-mono">{message.reference}</span>
            </Detail>
            <Detail term={t("detail.statusLabel")}>
              <span className="flex flex-wrap items-center gap-2">
                <Chip tone={STATUS_TONE[message.status]}>
                  {t(`status.${message.status}`)}
                </Chip>
                {message.closedAt && message.closeReason ? (
                  <span>
                    {t("detail.closedOn", {
                      date: when(message.closedAt),
                      reason: t(`closeReasons.${message.closeReason}`),
                    })}
                  </span>
                ) : null}
              </span>
            </Detail>
            <Detail term={t("detail.topic")}>
              {topics(`${message.topic}.title`)}
            </Detail>
            <Detail term={t("detail.team")}>
              {t(`teams.${message.team}`)}
            </Detail>
            <Detail term={t("detail.received")}>
              {when(message.createdAt)}
            </Detail>
            <Detail term={t("detail.assignee")}>
              {message.assignee?.name ?? t("detail.nobody")}
            </Detail>
          </dl>
        </section>

        <section aria-labelledby="message-sender" className={CARD}>
          <SectionHeading id="message-sender" title={t("detail.sender")} />
          <dl className="mt-4 flex flex-col gap-3">
            <Detail term={t("detail.name")}>{message.name}</Detail>
            <Detail term={t("detail.email")}>
              <a href={`mailto:${message.email}`} className={LINK}>
                {message.email}
              </a>
            </Detail>
            <Detail term={t("detail.organisation")}>
              {message.organisation ?? t("detail.notGiven")}
            </Detail>
          </dl>
        </section>

        <section aria-labelledby="message-body" className={CARD}>
          <SectionHeading id="message-body" title={t("detail.message")} />
          <p className="mt-4 whitespace-pre-line text-ink wrap-anywhere">
            {message.message}
          </p>
          <p className="mt-4 text-sm text-ink-muted">
            {t("detail.reply", { email: message.email })}
          </p>
        </section>

        <section aria-labelledby="message-status" className={CARD}>
          <SectionHeading
            id="message-status"
            title={t("detail.statusForm.title")}
          />
          <div className="mt-4">
            <StatusForm
              messageId={message.id}
              status={message.status}
              closeReasons={CONTACT_CLOSE_REASONS.map((value) => ({
                value,
                label: t(`closeReasons.${value}`),
              }))}
              labels={{
                ...callout,
                start: t("detail.statusForm.start"),
                reopen: t("detail.statusForm.reopen"),
                reason: t("detail.statusForm.reason"),
                chooseReason: t("detail.statusForm.chooseReason"),
                close: t("detail.statusForm.close"),
                saving: t("detail.statusForm.saving"),
              }}
            />
          </div>
        </section>

        <section aria-labelledby="message-assignee" className={CARD}>
          <SectionHeading
            id="message-assignee"
            title={t("detail.assignForm.title")}
          />
          {message.status === "closed" ? (
            <p className="mt-4 text-ink">{t("detail.assignForm.closed")}</p>
          ) : (
            <div className="mt-4">
              <AssignForm
                messageId={message.id}
                assigneeId={message.assignee?.id ?? null}
                staff={message.assignableStaff.map((person) => ({
                  value: person.id,
                  label: person.name,
                }))}
                labels={{
                  ...callout,
                  label: t("detail.assignForm.label"),
                  nobody: t("detail.nobody"),
                  save: t("detail.assignForm.save"),
                  saving: t("detail.assignForm.saving"),
                }}
              />
            </div>
          )}
        </section>

        <section aria-labelledby="message-notes" className={CARD}>
          <SectionHeading id="message-notes" title={t("detail.notes.title")} />
          {message.notes.length === 0 ? (
            <p className="mt-4 text-ink-muted">{t("detail.notes.empty")}</p>
          ) : (
            <ol className="mt-4 flex flex-col gap-4">
              {message.notes.map((note) => (
                <li
                  key={note.id}
                  className="rounded-2xl border-2 border-border bg-surface-muted p-4"
                >
                  <p className="whitespace-pre-line text-ink wrap-anywhere">
                    {note.body}
                  </p>
                  <p className="mt-2 text-sm text-ink-muted">
                    {t("detail.notes.by", {
                      name: note.author?.name ?? t("detail.notes.formerStaff"),
                      date: when(note.createdAt),
                    })}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <div className="mt-6">
            <NoteForm
              messageId={message.id}
              maxLength={CONTACT_NOTE_MAX}
              labels={{
                ...callout,
                label: t("detail.notes.label"),
                hint: t("detail.notes.hint"),
                save: t("detail.notes.save"),
                saving: t("detail.notes.saving"),
              }}
            />
          </div>
        </section>
      </div>
    </>
  );
}
