// The announcements module (#84): a competition manager writes, previews
// and sends an announcement to a competition's confirmed registrants. The
// fan-out runs in the worker (./fan-out.ts), through the notifications
// module. Its use cases join `as(actor)` through `announcementsUseCases`.

import type { UseCaseContext } from "../../use-cases";
import type { AnnouncementContentInput } from "./domain/content";
import {
  createAnnouncement,
  getAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type AnnouncementTarget,
} from "./use-cases/drafts";
import { previewAnnouncement } from "./use-cases/preview";
import { sendAnnouncement, type SendAnnouncementInput } from "./use-cases/send";

export type {
  AnnouncementCompetition,
  AnnouncementSummary,
  AnnouncementView,
  CreateAnnouncementResult,
  GetAnnouncementResult,
  ListAnnouncementsResult,
  UpdateAnnouncementResult,
} from "./use-cases/drafts";
export type {
  AnnouncementPreview,
  PreviewAnnouncementResult,
} from "./use-cases/preview";
export type { SendAnnouncementResult } from "./use-cases/send";
export type {
  AnnouncementContent,
  AnnouncementContentInput,
} from "./domain/content";
export type { AnnouncementStatus } from "./domain/status";
export { ANNOUNCEMENTS_POLICY, type AnnouncementsAction } from "./policy";

export const announcementsUseCases = (ctx: UseCaseContext) => ({
  createAnnouncement: (input: {
    competitionId: string;
    content: AnnouncementContentInput;
  }) => createAnnouncement(ctx, input),
  updateAnnouncement: (
    input: AnnouncementTarget & { content: AnnouncementContentInput }
  ) => updateAnnouncement(ctx, input),
  getAnnouncement: (input: AnnouncementTarget) => getAnnouncement(ctx, input),
  listAnnouncements: (input: { competitionId: string }) =>
    listAnnouncements(ctx, input),
  previewAnnouncement: (input: AnnouncementTarget) =>
    previewAnnouncement(ctx, input),
  sendAnnouncement: (input: SendAnnouncementInput) =>
    sendAnnouncement(ctx, input),
});
