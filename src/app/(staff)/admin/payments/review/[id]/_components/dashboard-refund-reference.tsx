"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";

import { TextField } from "@/components/form";

export function DashboardRefundReference(
  props: ComponentProps<typeof TextField>
) {
  const ref = useRef<HTMLInputElement>(null);
  const { pending } = useFormStatus();
  const { error } = props;

  useEffect(() => {
    if (error && !pending) ref.current?.focus();
  }, [error, pending]);

  return <TextField {...props} ref={ref} />;
}
