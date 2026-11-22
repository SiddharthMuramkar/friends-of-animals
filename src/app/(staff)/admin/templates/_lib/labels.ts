// Staff-facing names for template keys, event types and sample values.
// Keys and event types are data (a later ticket's migration adds rows), so
// they are looked up in the raw messages (next-intl nests them on dots),
// and one missing from messages/en-IN/adminTemplates.json falls back.

export type NameTree = { [part: string]: string | NameTree };

/** The string at a dotted path such as `identity.welcome`, if any. */
export function lookupName(tree: NameTree, dotted: string): string | undefined {
  let node: string | NameTree | undefined = tree;
  for (const part of dotted.split(".")) {
    if (typeof node !== "object" || !Object.hasOwn(node, part))
      return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** The name for `dotted`, or `dotted` itself. */
export function nameOr(tree: NameTree, dotted: string): string {
  return lookupName(tree, dotted) ?? dotted;
}
