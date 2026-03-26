import { createLogger } from '@expo/logger';
import { Response } from 'node-fetch';
import fetch from 'node-fetch';

import HttpLogStream from '../utils/HttpLogStream';

jest.mock('node-fetch', () => {
  const actual = jest.requireActual('node-fetch');
  return {
    __esModule: true,
    ...actual,
    default: jest.fn(),
  };
});
jest.mock('../utils/retry', () => ({
  retry: jest.fn(async (fn: (attemptCount: number) => Promise<unknown>) => await fn(0)),
}));

const fetchMock = jest.mocked(fetch);

function createResponse(status = 200, body = ''): Response {
  return new Response(body, { status, statusText: status === 200 ? 'OK' : 'Error' });
}

function parseRequestLogs(): any[][] {
  return fetchMock.mock.calls.map(([, requestInit]) =>
    String(requestInit?.body)
      .split('\n')
      .filter(Boolean)
      .map(serializedLog => JSON.parse(serializedLog))
  );
}

describe(HttpLogStream.name, () => {
  let now = 0;
  let dateNowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    fetchMock.mockReset();
    now = 0;
    dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it('splits HTTP uploads by serialized payload size', async () => {
    let resolveFirstResponse: ((value: Response) => void) | undefined;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirstResponse = resolve;
          })
      )
      .mockResolvedValue(createResponse())
      .mockResolvedValue(createResponse());

    const stream = new HttpLogStream({
      url: 'https://logs.expo.test/build-id',
      headers: { Authorization: 'Bearer token' },
      logger: createLogger({ name: 'test' }),
    });

    stream.write({ logId: 'first', msg: 'head' });
    stream.write({ logId: 'second', msg: 'a'.repeat(120_000) });
    stream.write({ logId: 'third', msg: 'b'.repeat(120_000) });

    resolveFirstResponse!(createResponse());
    await stream.cleanUp();

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [firstRequestLogs, secondRequestLogs, thirdRequestLogs] = parseRequestLogs();
    expect(firstRequestLogs).toHaveLength(1);
    expect(secondRequestLogs).toHaveLength(1);
    expect(thirdRequestLogs).toHaveLength(1);
    expect(secondRequestLogs[0].logId).toBe('second');
    expect(thirdRequestLogs[0].logId).toBe('third');
  });

  it('drops buffered logs that are older than the retention window', async () => {
    let resolveFirstResponse: ((value: Response) => void) | undefined;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirstResponse = resolve;
          })
      )
      .mockResolvedValue(createResponse());

    const stream = new HttpLogStream({
      url: 'https://logs.expo.test/build-id',
      headers: { Authorization: 'Bearer token' },
      logger: createLogger({ name: 'test' }),
      bufferRetentionMs: 30_000,
    });

    stream.write({ logId: 'first', msg: 'in-flight' });

    now = 1_000;
    stream.write({ logId: 'second', msg: 'stale-buffered' });

    now = 40_000;
    stream.write({ logId: 'third', msg: 'fresh-buffered' });

    resolveFirstResponse!(createResponse());
    await stream.cleanUp();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [firstRequestLogs, secondRequestLogs] = parseRequestLogs();
    expect(firstRequestLogs.map(log => log.logId)).toEqual(['first']);
    expect(secondRequestLogs.map(log => log.logId)).toEqual(['third']);
  });

  it('does not trim buffered logs when retention is disabled', async () => {
    let resolveFirstResponse: ((value: Response) => void) | undefined;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirstResponse = resolve;
          })
      )
      .mockResolvedValue(createResponse());

    const stream = new HttpLogStream({
      url: 'https://logs.expo.test/build-id',
      headers: { Authorization: 'Bearer token' },
      logger: createLogger({ name: 'test' }),
      bufferRetentionMs: null,
    });

    stream.write({ logId: 'first', msg: 'in-flight' });

    now = 1_000;
    stream.write({ logId: 'second', msg: 'old-buffered' });

    now = 40_000;
    stream.write({ logId: 'third', msg: 'new-buffered' });

    resolveFirstResponse!(createResponse());
    await stream.cleanUp();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [firstRequestLogs, secondRequestLogs] = parseRequestLogs();
    expect(firstRequestLogs.map(log => log.logId)).toEqual(['first']);
    expect(secondRequestLogs.map(log => log.logId)).toEqual(['second', 'third']);
  });
});
