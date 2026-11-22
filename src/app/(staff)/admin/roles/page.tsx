import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { ListUserRolesResult } from "@/server/access";
import { ROLES, SCOPE_TYPES } from "@/server/access/domain/roles";

import { AdminDenied } from "../_components/admin-denied";
import { adminCall } from "../_lib/boundary";
import { grantLabel } from "../_lib/grant-label";
import { auditHref } from "../audit/_lib/filters";
import { ChangeNotice } from "./_components/change-notice";
import { GrantForm } from "./_components/grant-form";
import { RevokeForm } from "./_components/revoke-form";
import { UserSearch } from "./_components/user-search";
import { readRolesParams, rolesHref, type RolesParams } from "./_lib/href";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminRoles.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = PageProps<"/admin/roles">["searchParams"];

export default async function Page({
  searchParams,
}: PageProps<"/admin/roles">) {
  const [t, admin] = await Promise.all([
    getTranslations("adminRoles"),
    getTranslations("admin"),
  ]);
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* The actor is read per request, so it streams in behind this
          boundary while the heading above is prerendered. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{admin("loading")}</p>}
      >
        <Roles searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/**
 * Runs the page's use cases; undefined when the policy refuses. The search
 * itself is a Server Action (UserSearch), so its text never reaches the
 * URL. Here an empty search checks the policy before the input, so a
 * member is refused on arrival without a query running, and its expected
 * "invalid input" is ignored.
 */
async function load(
  params: RolesParams
): Promise<{ chosen?: ListUserRolesResult } | undefined> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const app = as(actor);
  const userId = params.user;
  const called = await adminCall(
    () =>
      Promise.all([
        app.searchUsers({ query: "" }),
        userId ? app.listUserRoles({ userId }) : undefined,
      ]),
    rolesHref({ user: userId })
  );
  if (!called.ok) return undefined;
  const [, chosen] = called.value;
  return { chosen };
}

async function Roles({ searchParams }: { searchParams: SearchParams }) {
  const params = readRolesParams(await searchParams);
  const loaded = await load(params);
  if (!loaded) return <AdminDenied />;
  const { chosen } = loaded;
  const [t, common] = await Promise.all([
    getTranslations("adminRoles"),
    getTranslations("common.callout"),
  ]);

  return (
    <div className="mt-8 flex flex-col gap-10">
      {params.done && params.at ? (
        <ChangeNotice
          key={params.at}
          label={common("success")}
          message={t(`done.${params.done}`)}
        />
      ) : null}

      <UserSearch
        chosenId={params.user}
        className={CARD}
        labels={{
          title: t("search.title"),
          label: t("search.label"),
          hint: t("search.hint"),
          submit: t("search.submit"),
          pending: t("search.pending"),
          results: t("search.results"),
          selected: t("search.selected"),
          noEmail: t("user.noEmail"),
        }}
      />

      {chosen ? (
        // A new key after each change, so its forms start afresh: a
        // refusal shown before a grant that worked mustn't linger.
        <Chosen key={`${params.user}:${params.at ?? ""}`} result={chosen} />
      ) : null}
    </div>
  );
}

async function Chosen({ result }: { result: ListUserRolesResult }) {
  const [t, admin, common, format] = await Promise.all([
    getTranslations("adminRoles"),
    getTranslations("admin"),
    getTranslations("common.callout"),
    getFormatter(),
  ]);
  if (!result.ok) {
    return <p className="text-ink">{t("user.notFound")}</p>;
  }
  const { user, grants } = result;

  return (
    <section aria-labelledby="roles-user" className="flex flex-col gap-6">
      <div>
        <SectionHeading
          id="roles-user"
          title={t("user.title", { name: user.name })}
        />
        <p className="mt-2 text-ink-muted wrap-anywhere">
          {user.email ?? t("user.noEmail")}
        </p>
        <p className="mt-2">
          <SiteLink href={auditHref({ person: user.id })} className={LINK}>
            {t("user.audit", { name: user.name })}
          </SiteLink>
        </p>
      </div>

      {grants.length === 0 ? (
        <p className="text-ink">{t("user.none", { name: user.name })}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {grants.map((grant) => {
            const label = grantLabel(admin, grant);
            const date = format.dateTime(grant.grantedAt, "longDateTime");
            return (
              <li key={label} className={CARD}>
                <p className="font-semibold text-ink wrap-anywhere">{label}</p>
                <p className="mt-1 text-ink-muted">
                  {grant.grantedBy
                    ? t("user.grantedBy", { date, name: grant.grantedBy.name })
                    : t("user.grantedAt", { date })}
                </p>
                <div className="mt-4">
                  <RevokeForm
                    userId={user.id}
                    grant={{
                      role: grant.role,
                      scopeType: grant.scope.type,
                      scopeId:
                        grant.scope.type === "global" ? "" : grant.scope.id,
                    }}
                    labels={{
                      submit: t("revoke.submit"),
                      submitFor: t("revoke.submitFor", { grant: label }),
                      pending: t("revoke.pending"),
                      problem: common("danger"),
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section aria-labelledby="roles-grant" className={CARD}>
        <h3 id="roles-grant" className="text-lead font-bold text-ink">
          {t("grantForm.title")}
        </h3>
        <div className="mt-4">
          <GrantForm
            userId={user.id}
            roles={ROLES.map((role) => ({
              value: role,
              label: admin(`roles.${role}`),
            }))}
            scopes={SCOPE_TYPES.map((scope) => ({
              value: scope,
              label: admin(`scopes.${scope}`),
            }))}
            labels={{
              role: t("grantForm.role"),
              scopeType: t("grantForm.scopeType"),
              scopeId: t("grantForm.scopeId"),
              scopeIdHint: t("grantForm.scopeIdHint"),
              choose: t("grantForm.choose"),
              submit: t("grantForm.submit"),
              pending: t("grantForm.pending"),
              problem: common("danger"),
            }}
          />
        </div>
      </section>
    </section>
  );
}
