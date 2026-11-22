"use client";

import {
  createContext,
  use,
  useActionState,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { FormAlert } from "@/components/form";

import { signOutSessionAction } from "../_lib/actions";
import { NO_NOTICE } from "../_lib/sign-out-state";

const SignOutAction = createContext<((formData: FormData) => void) | null>(
  null
);

/**
 * Signing one session out, for the list inside it: each row's
 * <SignOutForm> runs the action here, and the notice that a device is
 * signed out shows here, above the list. The state can't sit in a row:
 * the pressed row leaves the list, and would take the notice with it.
 *
 * The notice is for the sign-out that just happened. Next.js keeps this
 * page hidden in <Activity> while the visitor is on another page, and
 * shows it again on Back; the notice is cleared as the page hides, so it
 * isn't announced (or focused) a second time.
 */
export function SessionSignOut({
  label,
  message,
  children,
}: {
  label: string;
  message: string;
  children: ReactNode;
}) {
  const [{ noticeId }, signOut] = useActionState(
    signOutSessionAction,
    NO_NOTICE
  );
  const [cleared, setCleared] = useState<string | null>(null);
  // Runs as Activity hides the page (and when a newer notice replaces it).
  useLayoutEffect(() => {
    if (!noticeId) return;
    return () => setCleared(noticeId);
  }, [noticeId]);

  return (
    <SignOutAction value={signOut}>
      {noticeId && noticeId !== cleared ? (
        <SignedOutNotice key={noticeId} label={label} message={message} />
      ) : null}
      {children}
    </SignOutAction>
  );
}

/** One row's sign-out form; render it inside <SessionSignOut>. */
export function SignOutForm({
  sessionId,
  className,
  children,
}: {
  sessionId: string;
  className?: string;
  children: ReactNode;
}) {
  const signOut = use(SignOutAction);
  if (!signOut) throw new Error("<SignOutForm> needs a <SessionSignOut>");
  return (
    <form action={signOut} className={className}>
      <input type="hidden" name="sessionId" value={sessionId} />
      {children}
    </form>
  );
}

/**
 * Says a device was signed out, and takes focus: the button that was
 * pressed has gone with its row, so focus would otherwise drop to the top
 * of the page with nothing announced. A new sign-out gives it a new `key`,
 * so it mounts (and takes focus) again.
 */
function SignedOutNotice({
  label,
  message,
}: {
  label: string;
  message: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <FormAlert tone="success" label={label}>
        {message}
      </FormAlert>
    </div>
  );
}
