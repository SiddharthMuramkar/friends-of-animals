import { isIPv4, isIPv6 } from "node:net";

/**
 * An IPv6 address's eight 16-bit groups. A trailing dotted IPv4 part
 * (`::ffff:198.51.100.7`) counts as the last two.
 */
function ipv6Groups(address: string): number[] {
  let text = address;
  const tail = text.slice(text.lastIndexOf(":") + 1);
  if (isIPv4(tail)) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split(".").map(Number);
    text = `${text.slice(0, -tail.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", rest] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const gap = rest === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<string>(gap).fill("0"), ...right].map((group) =>
    Number.parseInt(group, 16)
  );
}

/** RFC 5952 text: lower case, the longest run of zero groups as "::". */
function compress(groups: number[]): string {
  let best = { start: -1, length: 0 };
  for (let start = 0; start < groups.length; start++) {
    let length = 0;
    while (groups[start + length] === 0) length++;
    if (length > best.length) best = { start, length };
  }
  const text = groups.map((group) => group.toString(16));
  if (best.length < 2) return text.join(":");
  const before = text.slice(0, best.start).join(":");
  const after = text.slice(best.start + best.length).join(":");
  return `${before}::${after}`;
}

/**
 * The network an address stands for: an IPv4 address as it is, an IPv6
 * address as its /64 (one home or phone connection usually holds a whole
 * /64), and an IPv4-mapped IPv6 address as its IPv4 address. Anything else
 * comes back unchanged.
 *
 *   ipNetwork("2409:4060:2e0f:8a2b:1c3d::1")  →  "2409:4060:2e0f:8a2b::/64"
 */
export function ipNetwork(address: string): string {
  const ip = address.trim().split("%")[0] ?? "";
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return address;
  const groups = ipv6Groups(ip);
  if (
    groups.slice(0, 5).every((group) => group === 0) &&
    groups[5] === 0xffff
  ) {
    const [high = 0, low = 0] = groups.slice(6);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }
  return `${compress([...groups.slice(0, 4), 0, 0, 0, 0])}/64`;
}
