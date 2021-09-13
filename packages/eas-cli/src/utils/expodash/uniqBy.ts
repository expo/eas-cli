export default function uniqBy<T, K = any>(list: T[], getKey: (item: T) => K): T[] {
  const uniqueValues = new Set();
  const result: T[] = [];
  for (const i of list) {
    if (!uniqueValues.has(getKey(i))) {
      result.push(i);
      uniqueValues.add(getKey(i));
    }
  }
  return result;
}
