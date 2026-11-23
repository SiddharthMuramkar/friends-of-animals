// What an entry's file holds. Images arrive here; video, documents and
// typed essays (#86) use the same entry file rows with their own kind, so
// every kind exists from the start, as the statuses do.
//
// Pure: no I/O, no "server-only".

export const ENTRY_FILE_KINDS = ["image", "video", "document", "text"] as const;

export type EntryFileKind = (typeof ENTRY_FILE_KINDS)[number];
