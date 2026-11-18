import { SITE } from "@/lib/site";

export default function HomePage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center px-4 py-16 text-center sm:px-6 sm:py-24">
      {/* Decorative here: the heading below names the organisation. On a
          white plate in dark mode, as in the header. */}
      {/* oxlint-disable-next-line nextjs/no-img-element -- SVG master, nothing to optimise */}
      <img
        src={SITE.logo.src}
        alt=""
        width={SITE.logo.width}
        height={SITE.logo.height}
        className="h-auto w-56 rounded-lg sm:w-72 dark:bg-white dark:p-3"
      />
      <h1 className="mt-10 text-3xl font-bold tracking-tight text-balance sm:text-5xl">
        {SITE.name}
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-pretty text-muted-foreground">
        {SITE.tagline}
      </p>
      <p className="mt-10 text-sm text-muted-foreground">
        Get in touch:{" "}
        <a
          href={`mailto:${SITE.contactEmail}`}
          className="font-medium text-foreground underline underline-offset-4"
        >
          {SITE.contactEmail}
        </a>
      </p>
    </section>
  );
}
