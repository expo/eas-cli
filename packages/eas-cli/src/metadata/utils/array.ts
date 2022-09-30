/**
 * Filter the array using a truthy predicate, returning a type-safe truthy array.
 */
export function coalesce<T>(list: (T | undefined | null)[]): T[] {
  return list.filter(Boolean) as T[];
}
