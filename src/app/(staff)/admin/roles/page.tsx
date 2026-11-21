import { Search } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { TextField } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { as, currentActor } from "@/server/app";
import type { ListUserRolesResult, SearchUsersResult } from "@/server/access";
import { ROLES, SCOPE_TYPES } from "@/server/access/domain/roles";

import { AdminDenied } from "../_components/admin-denied";
import { grantLabel } from "../_lib/grant-label";
import { isRefusal } from "../_lib/refusal";
import { ChangeNotice } from "./_components/change-notice";
import { GrantForm } from "./_components/grant-form";
import { RevokeForm } from "./_components/revoke-form";
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

type Loaded = { found: SearchUsersResult; chosen?: ListUserRolesResult };

/**
 * Runs the page's use cases; undefined when the policy refuses. The search
 * always runs, with an empty query before anyone has typed: it checks the
 * policy before the input, so a member is refused on arrival, and an
 * empty query then comes back as invalid input, which means "no search".
 */
async function load(params: RolesParams): Promise<Loaded | undefined> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const app = as(actor);
  try {
    const [found, chosen] = await Promise.all([
      app.searchUsers({ query: params.q ?? "" }),
      params.user ? app.listUserRoles({ userId: params.user }) : undefined,
    ]);
    return { found, chosen };
  } catch (error) {
    if (isRefusal(error)) return undefined;
    throw error;
  }
}

async function Roles({ searchParams }: { searchParams: SearchParams }) {
  const params = readRolesParams(await searchParams);
  const loaded = await load(params);
  if (!loaded) return <AdminDenied />;
  const { found, chosen } = loaded;
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

      {/* Block: before Safari 17 <search> is an unknown, inline element. */}
      <search aria-labelledby="roles-search" className={cn("block", CARD)}>
        <h2 id="roles-search" className="text-lead font-bold text-ink">
          {t("search.title")}
        </h2>
        {/* A plain GET form: the search lands in the URL, no script needed. */}
        <form
          action={APP_ROUTES.adminRoles}
          className="mt-4 flex flex-col gap-4"
        >
          <TextField
            id="roles-q"
            name="q"
            type="search"
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
            defaultValue={params.q}
            label={t("search.label")}
            hint={t("search.hint")}
            error={
              params.q !== undefined && !found.ok
                ? t("search.tooShort")
                : undefined
            }
          />
          <div>
            <button type="submit" className={buttonStyles()}>
              <Search aria-hidden="true" />
              {t("search.submit")}
            </button>
          </div>
        </form>
      </search>

      {found.ok ? <Found users={found.users} params={params} /> : null}

      {chosen ? <Chosen result={chosen} params={params} /> : null}
    </div>
  );
}

async function Found({
  users,
  params,
}: {
  users: { id: string; name: string; email: string }[];
  params: RolesParams;
}) {
  const t = await getTranslations("adminRoles.search");
  return (
    <section aria-labelledby="roles-found">
      <SectionHeading id="roles-found" title={t("results")} />
      {users.length === 0 ? (
        <p className="mt-4 text-ink">{t("none", { query: params.q ?? "" })}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {users.map((user) => {
            const chosen = user.id === params.user;
            return (
              <li key={user.id}>
                <SiteLink
                  href={rolesHref({ q: params.q, user: user.id })}
                  aria-current={chosen ? "true" : undefined}
                  className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border-2 border-border bg-surface px-4 py-2 hover:border-border-strong aria-[current=true]:border-ink"
                >
                  <span className="font-semibold text-link underline decoration-2 underline-offset-4">
                    {user.name}
                  </span>
                  {/* An address is one long word: let it break anywhere. */}
                  <span className="text-ink-muted wrap-anywhere">
                    {user.email}
                  </span>
                  {chosen ? <Chip tone="blue">{t("selected")}</Chip> : null}
                </SiteLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

async function Chosen({
  result,
  params,
}: {
  result: ListUserRolesResult;
  params: RolesParams;
}) {
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
  const query = params.q ?? "";

  return (
    <section aria-labelledby="roles-user" className="flex flex-col gap-6">
      <div>
        <SectionHeading
          id="roles-user"
          title={t("user.title", { name: user.name })}
        />
        <p className="mt-2 text-ink-muted wrap-anywhere">{user.email}</p>
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
                    query={query}
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
            query={query}
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
