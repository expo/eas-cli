export default function partition<T>(arr: T[], predicate: (item: T) => boolean): [T[], T[]] {
  const trueItems: T[] = [];
  const falseItems: T[] = [];

  for (const item of arr) {
    if (predicate(item)) {
      trueItems.push(item);
    } else {
      falseItems.push(item);
    }
  }

  return [trueItems, falseItems];
}
