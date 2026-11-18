import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Long-form text (articles, policies): 68ch measure, rhythm, lists, links. */
export function Prose({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("prose-foa", className)}>{children}</div>;
}
