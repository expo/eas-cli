export function nullthrows<T>(value: T | null | undefined, message?: string): NonNullable<T> {
  if (value != null) {
    return value;
  }
  throw new TypeError(message ?? `Expected value not to be null or undefined but got ${value}`);
}
