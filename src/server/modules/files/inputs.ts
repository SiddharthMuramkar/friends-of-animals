// The shapes the Files module's use cases take (#63). An edge (the files
// API) parses a request with these before calling a use case, and each use
// case parses its input again, so neither trusts the other.
//
// Loads under plain Node: relative imports only, no "server-only".

import { z } from "zod";

import { FILE_PURPOSES } from "./domain/purposes";

/** requestUpload: what the browser declares about the file it will PUT. */
export const requestUploadInput = z.object({
  purpose: z.enum(FILE_PURPOSES),
  contentType: z.string().max(255),
  sizeBytes: z.int().nonnegative(),
});

/** completeUpload, getFileDownloadUrl and getFileStatus: one file's id. */
export const fileIdInput = z.object({ fileId: z.uuid() });
