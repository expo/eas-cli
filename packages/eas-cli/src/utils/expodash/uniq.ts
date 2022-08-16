export default function uniq<T = any>(items: T[]): T[] {
  const set = new Set(items);
  return [...set];
}
