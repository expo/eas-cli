export default function zipObject<T>(keys: string[], values: T[]): Record<string, T> {
  if (keys.length !== values.length) {
    throw new Error('The number of items does not match');
  }
  const result: Record<string, T> = {};
  for (let i = 0; i < keys.length; i++) {
    result[keys[i]] = values[i];
  }
  return result;
}
