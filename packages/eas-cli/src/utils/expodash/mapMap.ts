export default function mapMap<K, V, M>(
  map: ReadonlyMap<K, V>,
  mapper: (value: V, key: K) => M
): Map<K, M> {
  const resultingMap = new Map();
  for (const [k, v] of map) {
    resultingMap.set(k, mapper(v, k));
  }
  return resultingMap;
}
