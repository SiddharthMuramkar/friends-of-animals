// Loads src/assets/site-art/art.json through the registry schema, as the
// site does, and fails loudly on a bad entry. Run by build.ts after a build.
import { art } from "../../src/lib/art/art";

console.log(`art.json passes the registry schema (${art.length} entries)`);
