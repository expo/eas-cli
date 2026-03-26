export function duplicates<T>(items: T[]): T[] {
  const visitedItemsSet = new Set<T>();
  const duplicatedItemsSet = new Set<T>();
  for (const item of items) {
    if (visitedItemsSet.has(item)) {
      duplicatedItemsSet.add(item);
    } else {
      visitedItemsSet.add(item);
    }
  }
  return [...duplicatedItemsSet];
}
