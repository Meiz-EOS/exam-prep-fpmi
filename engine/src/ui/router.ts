/** Route ids are plain `#name` hashes (the only form claude.ai keeps). */
export function routeFromHash(hash: string, available: readonly string[]): string | undefined {
  const name = hash.replace(/^#/, "");
  return available.includes(name) ? name : available[0];
}
