import { isIP } from "node:net";

import { ipNetwork } from "@/lib/ip-network";

export type SessionAddress = { kind: "ip" | "network"; text: string };

/**
 * What the sessions page says about where a session started. Better Auth
 * stores an IPv6 address as its zero-padded /64 network (39 characters,
 * which overflow a phone screen, and not the device's own address), so it
 * is shown compressed and called a network; an IPv4 address is shown as it
 * is. No address, or one that isn't an IP, shows nothing.
 */
export function sessionAddress(
  stored: string | null
): SessionAddress | undefined {
  const ip = stored?.trim() ?? "";
  if (isIP(ip) === 0) return undefined;
  const text = ipNetwork(ip);
  return isIP(text) === 4 ? { kind: "ip", text } : { kind: "network", text };
}
