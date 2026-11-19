import { DoodleLauncher } from "./doodle-launcher";

/**
 * A server component between the 404 page and the launcher. next/dynamic does
 * not split a client component imported straight from a server one, but it
 * does lazy-load the client children of a dynamically imported server
 * component. So the launcher gets its own chunk, fetched only when the 404
 * renders, not with every route that bundles the root not-found (#45).
 */
export default function DoodleSlot(
  props: React.ComponentProps<typeof DoodleLauncher>
) {
  return <DoodleLauncher {...props} />;
}
