/** Run async work over items with a fixed concurrency limit. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const concurrency = Math.max(1, Math.min(limit, items.length))
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex
      nextIndex += 1
      if (i >= items.length) return
      results[i] = await fn(items[i]!, i)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return results
}
