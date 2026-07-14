export async function mapWithConcurrency<I, O>(
  items: readonly I[],
  worker: (item: I, index: number) => Promise<O>,
  limit: number
): Promise<O[]> {
  const effectiveLimit = Math.max(1, limit);
  const results: O[] = new Array(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  const pool = Array.from(
    { length: Math.min(effectiveLimit, items.length) },
    () => run()
  );

  await Promise.all(pool);
  return results;
}
