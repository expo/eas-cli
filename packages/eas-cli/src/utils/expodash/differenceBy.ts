export default function differenceBy<T extends object>(a: T[], b: T[], key: keyof T): T[] {
  const valuesInB = b.map(j => j[key]);
  return a.filter(i => !valuesInB.includes(i[key]));
}
