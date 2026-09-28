import { graphqlAbortContext } from '../graphqlAbort';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

it('returns nothing without a signal', () => {
  expect(graphqlAbortContext(undefined)).toBeUndefined();
});

it('aborts the request when either the caller or urql aborts', async () => {
  const seen: AbortSignal[] = [];
  globalThis.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init!.signal!);
    return new Response('{}');
  }) as typeof fetch;
  const caller = new AbortController();
  const urql = new AbortController();
  const context = graphqlAbortContext(caller.signal)!;
  await context.fetch!('https://api.test/graphql', { method: 'POST', signal: urql.signal });
  await context.fetch!('https://api.test/graphql', { method: 'POST' });
  expect(seen).toHaveLength(2);
  expect(seen.every(signal => !signal.aborted)).toBe(true);
  urql.abort(new Error('urql gave up'));
  expect(seen[0].aborted).toBe(true);
  expect(seen[1].aborted).toBe(false);
  caller.abort(new Error('caller gave up'));
  expect(seen[1].aborted).toBe(true);
});
