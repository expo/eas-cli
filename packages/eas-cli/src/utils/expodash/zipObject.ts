export default function zipObject<T>(keys: string[], values: T[]): Record<string, T> {
  const result: Record<string, T> = {};
  for (let i = 0; i < keys.length; i++) {
    result[keys[i]] = values[i];
  }
  return result;
}
