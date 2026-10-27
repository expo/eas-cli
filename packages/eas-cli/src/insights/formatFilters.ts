/** Entries render in the order the caller lists them. */
export function formatAppliedFilters(
  entries: [label: string, value: string | string[] | undefined][]
): string {
  return entries
    .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : Boolean(value)))
    .map(([label, value]) => `${label}: ${Array.isArray(value) ? value.join(', ') : value}`)
    .join('; ');
}
