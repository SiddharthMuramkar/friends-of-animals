import type { ComponentProps } from "react";

export type HeadingLevel = 2 | 3 | 4;

/** An <h2>–<h4> chosen by the caller, so components fit any outline. */
export function H({
  level,
  ...props
}: { level: HeadingLevel } & ComponentProps<"h2">) {
  const Tag = `h${level}` as const;
  return <Tag {...props} />;
}

export function sub(level: HeadingLevel): HeadingLevel {
  return level === 2 ? 3 : 4;
}
