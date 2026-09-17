export async function filterResolvedPrefixes<TItem, TResolved, TAccepted>(
  items: TItem[],
  prefixSize: number,
  resolvePrefix: (items: TItem[]) => Promise<TResolved[]>,
  acceptResolved: (item: TItem, resolved: TResolved | undefined) => TAccepted | null,
  onPartial?: (accepted: TAccepted[]) => void,
): Promise<TAccepted[]> {
  if (!Number.isInteger(prefixSize) || prefixSize <= 0) {
    throw new Error('PROGRESSIVE_PREFIX_SIZE_INVALID');
  }

  const accepted: TAccepted[] = [];
  let lastPublishedCount = 0;
  for (let offset = 0; offset < items.length; offset += prefixSize) {
    const prefix = items.slice(offset, offset + prefixSize);
    const resolved = await resolvePrefix(prefix);
    for (let index = 0; index < prefix.length; index += 1) {
      const candidate = acceptResolved(prefix[index], resolved[index]);
      if (candidate !== null) accepted.push(candidate);
    }
    if (onPartial && accepted.length > lastPublishedCount) {
      lastPublishedCount = accepted.length;
      onPartial([...accepted]);
    }
  }
  return accepted;
}

export function shouldApplyProgressivePartial(
  requestGeneration: number,
  currentGeneration: number,
  page: number,
): boolean {
  return page === 1 && requestGeneration === currentGeneration;
}
