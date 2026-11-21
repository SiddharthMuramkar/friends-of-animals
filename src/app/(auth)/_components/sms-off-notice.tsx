import { CALLOUT_TONE, calloutBox } from "@/components/site/callout-tone";
import { SiteLink } from "@/components/site/site-link";
import { cn } from "@/lib/utils";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/**
 * Shown in place of the phone form while SMS is switched off: codes come
 * by email, and here is the way in by email. An icon and a word
 * (`label`, common.callout.info) carry its meaning, not colour alone.
 */
export function SmsOffNotice({
  label,
  message,
  link,
}: {
  label: string;
  message: string;
  link: { href: string; text: string };
}) {
  const { icon: Icon, box, label: word } = CALLOUT_TONE.info;
  return (
    <aside className={cn(calloutBox, box)}>
      <p className={cn("flex items-center gap-2 font-semibold", word)}>
        <Icon aria-hidden="true" className="size-5 shrink-0" />
        <span>{label}</span>
      </p>
      <div className="mt-2 text-ink">
        <p>{message}</p>
        <p>
          <SiteLink href={link.href} className={LINK}>
            {link.text}
          </SiteLink>
        </p>
      </div>
    </aside>
  );
}
