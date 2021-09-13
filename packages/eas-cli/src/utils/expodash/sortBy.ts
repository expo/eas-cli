export default function sortBy<T extends any>(
  list: T[],
  what?: keyof T,
  order: 'asc' | 'desc' = 'asc'
): T[] {
  const compareByFn =
    what &&
    ((a: T, b: T) => {
      const r = a[what] > b[what] ? 1 : b[what] > a[what] ? -1 : 0;
      return order === 'asc' ? r : -r;
    });
  return list.concat().sort(compareByFn);
}
