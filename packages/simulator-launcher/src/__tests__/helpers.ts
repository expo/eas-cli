export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Polls `predicate` for up to 2 seconds, then asserts it. */
export async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !predicate(); i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  expect(predicate()).toBe(true);
}
