export default function uniqBy<T extends object>(list: T[], key: keyof T): T[] {
  const uniqueValues = new Set();
  const result: T[] = [];
  for (const i of list) {
    if (!uniqueValues.has(i[key])) {
      result.push(i);
      uniqueValues.add(i[key]);
    }
  }
  return result;
}
