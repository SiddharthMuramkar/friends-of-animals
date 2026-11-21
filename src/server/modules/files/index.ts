// The Files module (#63): private uploads straight to object storage,
// checked against their declaration, scanned, and delivered through
// short-lived signed URLs. Its use cases join `as(actor)` through
// `filesUseCases`.

import type { UseCaseContext } from "../../use-cases";
import {
  getFileDerivativeUrl,
  type GetFileDerivativeUrlInput,
} from "./use-cases/derivative-url";
import {
  getFileDownloadUrl,
  type GetFileDownloadUrlInput,
} from "./use-cases/delivery";
import { getFileStatus, type GetFileStatusInput } from "./use-cases/status";
import {
  completeUpload,
  requestUpload,
  type CompleteUploadInput,
  type RequestUploadInput,
} from "./use-cases/upload";

export type {
  GetFileDerivativeUrlInput,
  GetFileDerivativeUrlResult,
} from "./use-cases/derivative-url";
export type { DerivativeKind } from "./domain/derivatives";
export type {
  GetFileDownloadUrlInput,
  GetFileDownloadUrlResult,
} from "./use-cases/delivery";
export type {
  GetFileStatusInput,
  GetFileStatusResult,
} from "./use-cases/status";
export type {
  CompleteUploadInput,
  CompleteUploadResult,
  RequestUploadInput,
  RequestUploadResult,
} from "./use-cases/upload";
export type { FilePurpose } from "./domain/purposes";
export type { FileStatus } from "./domain/file-status";

export const filesUseCases = (ctx: UseCaseContext) => ({
  requestUpload: (input: RequestUploadInput) => requestUpload(ctx, input),
  completeUpload: (input: CompleteUploadInput) => completeUpload(ctx, input),
  getFileDownloadUrl: (input: GetFileDownloadUrlInput) =>
    getFileDownloadUrl(ctx, input),
  getFileStatus: (input: GetFileStatusInput) => getFileStatus(ctx, input),
  getFileDerivativeUrl: (input: GetFileDerivativeUrlInput) =>
    getFileDerivativeUrl(ctx, input),
});
