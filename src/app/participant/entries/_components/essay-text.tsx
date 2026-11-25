import { cn } from "@/lib/utils";
import { sanitizeEssayBody, type EssayBody } from "@/server/rich-text/essay";

/**
 * A typed essay (#86): its paragraphs, each line a text node React escapes,
 * never HTML. It passes through the `essay` profile again here (cheap and
 * idempotent), so a stored row is shown only as the profile allows.
 */
export function EssayText({
  body,
  className,
}: {
  body: EssayBody;
  className?: string;
}) {
  const { paragraphs } = sanitizeEssayBody(body);
  return (
    <div className={cn("flex flex-col gap-3 text-ink", className)}>
      {paragraphs.map((lines, paragraph) => (
        <p key={paragraph} className="wrap-anywhere">
          {lines.map((line, at) => (
            <span key={at}>
              {at > 0 ? <br /> : null}
              {line}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
