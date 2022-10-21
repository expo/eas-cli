export default function intersection<T = any>(items1: T[], items2: T[]): T[] {
  const set1 = new Set(items1);
  const set2 = new Set(items2);
  return Array.from(new Set([...set1].filter(i => set2.has(i))));
}
