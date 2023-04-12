export default function areSetsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  return a.size === b.size && [...a].every(value => b.has(value));
}
