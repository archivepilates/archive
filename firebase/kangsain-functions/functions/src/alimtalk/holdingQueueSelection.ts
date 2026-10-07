import { isHoldingNoticeCandidate } from "./holdingNoticeQueue";

interface CandidateSnapshot {
  readonly id: string;
  data(): unknown;
}

interface CandidateQuery<Snapshot extends CandidateSnapshot> {
  limit(count: number): CandidateQuery<Snapshot>;
  startAfter(snapshot: Snapshot): CandidateQuery<Snapshot>;
  get(): Promise<{ readonly docs: readonly Snapshot[] }>;
}

const PAGE_SIZE = 20;
const NON_HOLDING_LIMIT = 20;

export async function selectHoldingQueueCandidates<Snapshot extends CandidateSnapshot>(
  query: CandidateQuery<Snapshot>,
): Promise<Snapshot[]> {
  const nonHolding: Snapshot[] = [];
  let holding: Snapshot | undefined;
  let cursor: Snapshot | undefined;

  // Holding-only pages must not consume the shared queue's non-holding budget.
  while (nonHolding.length < NON_HOLDING_LIMIT) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(PAGE_SIZE).get();
    for (const snapshot of page.docs) {
      if (isHoldingNoticeCandidate(snapshot.data())) {
        holding ??= snapshot;
      } else {
        nonHolding.push(snapshot);
        if (nonHolding.length === NON_HOLDING_LIMIT) break;
      }
    }
    if (page.docs.length < PAGE_SIZE) break;
    cursor = page.docs[page.docs.length - 1];
  }

  // Keep holding provider work behind the existing generic claim/send guards.
  return holding ? [...nonHolding, holding] : nonHolding;
}
