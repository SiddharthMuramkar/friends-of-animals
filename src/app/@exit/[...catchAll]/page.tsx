/**
 * Every route without its own exit bar. Without this, a client-side
 * navigation away from /safeguarding would keep showing its Quick exit bar,
 * because a slot keeps its last page when the new URL doesn't match it.
 */
export default function Page() {
  return null;
}
