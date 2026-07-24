/** Creates a dictionary that safely supports arbitrary user-defined keys such as `__proto__`. */
export function createNullPrototypeRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
