export default function uniqBy<T, K = any>(list: T[], getKey: (item: T) => K): T[] {
  const uniqueValues = new Set<K>();
  const result: T[] = [];
  for (const i of list) {
    const key = getKey(i);
    if (!uniqueValues.has(key)) {
      result.push(i);
      uniqueValues.add(key);
    }
  }
  return result;
}
