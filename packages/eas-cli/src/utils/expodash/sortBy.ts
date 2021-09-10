export default function sortBy<T>(list: T[], what?: string, order: 'asc' | 'desc' = 'asc'): T[] {
  const compareByFn = what !== undefined ? compareBy(what, order) : undefined;
  return list.concat().sort(compareByFn);
}

const compareBy = (key: string, order: 'asc' | 'desc') => {
  return (a: any, b: any) => {
    const r = a[key] > b[key] ? 1 : b[key] > a[key] ? -1 : 0;
    return order === 'asc' ? r : -r;
  };
};
