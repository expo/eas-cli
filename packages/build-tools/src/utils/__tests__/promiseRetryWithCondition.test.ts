import { promiseRetryWithCondition } from '../promiseRetryWithCondition';

it('reports the previous error and retry budget only when the next attempt starts', async () => {
  const errors = [new Error('First failure'), new Error('Second failure')];
  const fn = jest
    .fn()
    .mockRejectedValueOnce(errors[0])
    .mockRejectedValueOnce(errors[1])
    .mockResolvedValue('done');
  const onRetry = jest.fn();
  await expect(
    promiseRetryWithCondition(fn, () => true, { retries: 2, minTimeout: 1 }, onRetry)()
  ).resolves.toBe('done');
  expect(onRetry.mock.calls).toEqual([
    [{ attemptNumber: 2, maxAttemptsCount: 3, error: errors[0] }],
    [{ attemptNumber: 3, maxAttemptsCount: 3, error: errors[1] }],
  ]);
});

it('does not report a retry after the final failure', async () => {
  const error = new Error('Persistent failure');
  const fn = jest.fn().mockRejectedValue(error);
  const onRetry = jest.fn();
  await expect(
    promiseRetryWithCondition(fn, () => true, { retries: 1, minTimeout: 1 }, onRetry)()
  ).rejects.toBe(error);
  expect(onRetry.mock.calls).toEqual([[{ attemptNumber: 2, maxAttemptsCount: 2, error }]]);
  expect(fn).toHaveBeenCalledTimes(2);
});
