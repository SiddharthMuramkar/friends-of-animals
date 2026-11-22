"use client";

import { Search } from "lucide-react";
import { useActionState } from "react";

import { SubmitButton, TextField } from "@/components/form";
import { Chip } from "@/components/site/chip";
import { SectionHeading } from "@/components/site/heading";
import { SiteLink } from "@/components/site/site-link";
import { cn } from "@/lib/utils";

import { searchUsersAction } from "../_lib/actions";
import { rolesHref } from "../_lib/href";
import { EMPTY_SEARCH } from "../_lib/search-view";

export type UserSearchLabels = {
  title: string;
  label: string;
  hint: string;
  submit: string;
  pending: string;
  results: string;
  selected: string;
  noEmail: string;
};

/**
 * Finds a person by name or email address. The text posts to a Server
 * Action and the people found live in this form's state, so personal data
 * stays out of the URL, browser history and request logs. Each person
 * found links to their roles by id.
 */
export function UserSearch({
  chosenId,
  labels,
  className,
}: {
  /** The person whose roles are shown, marked in the list. */
  chosenId?: string;
  labels: UserSearchLabels;
  className?: string;
}) {
  const [view, formAction] = useActionState(searchUsersAction, EMPTY_SEARCH);
  return (
    <>
      {/* Block: before Safari 17 <search> is an unknown, inline element. */}
      <search aria-labelledby="roles-search" className={cn("block", className)}>
        <h2 id="roles-search" className="text-lead font-bold text-ink">
          {labels.title}
        </h2>
        <form action={formAction} className="mt-4 flex flex-col gap-4">
          {/* React resets the form after the action: defaultValue puts the
              search back. */}
          <TextField
            id="roles-q"
            name="q"
            type="search"
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
            defaultValue={view.query}
            label={labels.label}
            hint={labels.hint}
            error={view.error}
          />
          <div>
            <SubmitButton pendingLabel={labels.pending}>
              <Search aria-hidden="true" />
              {labels.submit}
            </SubmitButton>
          </div>
        </form>
      </search>

      {view.users ? (
        <section aria-labelledby="roles-found">
          <SectionHeading id="roles-found" title={labels.results} />
          {view.users.length === 0 ? (
            <p className="mt-4 text-ink">{view.none}</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {view.users.map((user) => {
                const chosen = user.id === chosenId;
                return (
                  <li key={user.id}>
                    <SiteLink
                      href={rolesHref({ user: user.id })}
                      aria-current={chosen ? "true" : undefined}
                      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border-2 border-border bg-surface px-4 py-2 hover:border-border-strong aria-[current=true]:border-ink"
                    >
                      <span className="font-semibold text-link underline decoration-2 underline-offset-4">
                        {user.name}
                      </span>
                      {/* An address is one long word: let it break anywhere.
                          An account made by phone (#58) has none. */}
                      <span className="text-ink-muted wrap-anywhere">
                        {user.email ?? labels.noEmail}
                      </span>
                      {chosen ? (
                        <Chip tone="blue">{labels.selected}</Chip>
                      ) : null}
                    </SiteLink>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}
