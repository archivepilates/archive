import type { MemberTagDoc } from "../types/models";
import { refs } from "./refs";

export async function getMemberTagsMap(memberIds: string[]): Promise<Map<string, MemberTagDoc["tags"]>> {
  const unique = [...new Set(memberIds.filter(Boolean))];
  if (!unique.length) return new Map();
  const snaps = await Promise.all(unique.map((memberId) => refs.memberTag(memberId).get()));
  return new Map(snaps
    .map((snap) => snap.data())
    .filter((doc): doc is MemberTagDoc => Boolean(doc))
    .map((doc) => [doc.memberId, doc.tags.filter((tag) => tag.source === "manual")]));
}

