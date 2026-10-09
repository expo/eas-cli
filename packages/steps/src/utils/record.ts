/** Creates an empty dictionary that safely supports arbitrary keys such as `__proto__`. */
export function createEmptyRecord<T extends Record<PropertyKey, unknown>>(): T {
  return Object.create(null) as T;
}
