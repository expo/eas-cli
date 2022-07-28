export default function chunk<T>(list: T[], size = 1): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < list.length; i++) {
    const isFirstElementInChunk = i % size === 0;
    if (isFirstElementInChunk) {
      result.push([list[i]]);
    } else {
      result[result.length - 1].push(list[i]);
    }
  }
  return result;
}
