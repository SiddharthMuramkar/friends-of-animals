export type SlugGate = { has(slug: string): Promise<boolean> };

export function createSlugGate(_options: {
  load: () => Promise<readonly string[]>;
  ttlMs: number;
  now?: () => number;
}): SlugGate {
  return { has: async () => false };
}
