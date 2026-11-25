import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { communityMember } from "../../db/schema";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { COMMUNITY_MEMBER_STATUSES } from "./domain/membership";
import { COMMUNITY_MEMBER_PURPOSE } from "./membership";

const PAGE_SIZE = 50;
const inputSchema = z.strictObject({
  status: z.enum(COMMUNITY_MEMBER_STATUSES).optional(),
  page: z.int().min(1).max(100000).default(1),
});
export type ListMembersInput = z.input<typeof inputSchema>;

export async function listMembers(
  ctx: UseCaseContext,
  input: ListMembersInput = {}
) {
  await authorize(ctx, "community.members.list");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ...invalidInput(parsed.error),
      members: [],
      page: 1,
      total: 0,
      pageSize: PAGE_SIZE,
    };
  const { status, page } = parsed.data;
  const where = status ? eq(communityMember.status, status) : undefined;
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({
        id: communityMember.id,
        displayNameCiphertext: communityMember.displayNameCiphertext,
        status: communityMember.status,
        subjectProfileId: communityMember.subjectProfileId,
        joinedAt: communityMember.joinedAt,
        leftAt: communityMember.leftAt,
      })
      .from(communityMember)
      .where(where)
      .orderBy(desc(communityMember.joinedAt), desc(communityMember.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    ctx.db.select({ count: count() }).from(communityMember).where(where),
  ]);
  return {
    ok: true,
    members: rows.map((row) => ({
      id: row.id,
      displayName: row.displayNameCiphertext
        ? ctx.cipher.decrypt(
            COMMUNITY_MEMBER_PURPOSE.displayName,
            row.displayNameCiphertext
          )
        : null,
      status: row.status,
      subjectKind: row.subjectProfileId ? "profile" : "user",
      joinedAt: row.joinedAt,
      leftAt: row.leftAt,
    })),
    page,
    total: total!.count,
    pageSize: PAGE_SIZE,
  } as const;
}
