export default async function mapMapAsync<K, V, M>(
  map: ReadonlyMap<K, V>,
  mapper: (value: V, key: K) => Promise<M>
): Promise<Map<K, M>> {
  const resultingMap: Map<K, M> = new Map();
  await Promise.all(
    Array.from(map.keys()).map(async k => {
      const initialValue = map.get(k) as V;
      const result = await mapper(initialValue, k);
      resultingMap.set(k, result);
    })
  );
  return resultingMap;
}
