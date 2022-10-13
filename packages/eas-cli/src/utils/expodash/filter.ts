/** Filter the array from `null` and `undefined` values, returning a type-safe array. */
export default function filter<T>(list: (T | undefined | null)[]): T[] {
  return list.filter<T>((i): i is T => i !== undefined && i !== null);
}
