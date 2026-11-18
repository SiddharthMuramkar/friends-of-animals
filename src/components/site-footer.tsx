import { cacheLife } from "next/cache";

import { SITE } from "@/lib/site";

// Reading the clock during prerendering needs a cache boundary under Cache
// Components; the year is refreshed daily.
async function CurrentYear() {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground sm:px-6">
        <p>
          © <CurrentYear /> {SITE.name} ·{" "}
          <a
            href={`mailto:${SITE.contactEmail}`}
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            {SITE.contactEmail}
          </a>
        </p>
      </div>
    </footer>
  );
}
