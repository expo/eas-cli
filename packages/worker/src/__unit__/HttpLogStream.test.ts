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

const fetchMock = jest.mocked(fetch);

describe(HttpLogStream.name, () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response('', { status: 200, statusText: 'OK' }));
  });

  it('forwards existing logId without adding log_id', async () => {
    const stream = new HttpLogStream({
      url: 'https://logs.expo.test/build-id',
      headers: {
        Authorization: 'Bearer token',
      },
      logger: createLogger({ name: 'test' }),
    });

    stream.write({
      msg: 'Test log',
      logId: '0195d537-3b2e-7c1a-8d5d-8d8ab2ad5ff1',
      phase: 'UNKNOWN',
    });

    await stream.cleanUp();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0];
    const [serializedLog] = String(requestInit?.body).split('\n');

    expect(JSON.parse(serializedLog)).toEqual({
      msg: 'Test log',
      logId: '0195d537-3b2e-7c1a-8d5d-8d8ab2ad5ff1',
      phase: 'UNKNOWN',
    });
  });
});
