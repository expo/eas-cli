import assert from 'assert';
import nock from 'nock';

import { ApiV2Error, api, getExpoApiBaseUrl } from '../api';

describe('apiClient', () => {
  it('converts Expo APIv2 error to ApiV2Error', async () => {
    nock(getExpoApiBaseUrl())
      .post('/v2/test')
      .reply(400, {
        errors: [
          {
            message: 'hellomessage',
            code: 'TEST_CODE',
            stack: 'line 1: hello',
            details: { who: 'world' },
            metadata: { an: 'object' },
          },
        ],
      });

    let error: Error | null = null;
    try {
      await api.postAsync('test', { body: {} });
    } catch (e: any) {
      error = e;
    }

    expect(error).toBeInstanceOf(ApiV2Error);
    assert(error instanceof ApiV2Error);

    expect(error.message).toEqual('hellomessage');
    expect(error.expoApiV2ErrorCode).toEqual('TEST_CODE');
    expect(error.expoApiV2ErrorDetails).toEqual({ who: 'world' });
    expect(error.expoApiV2ErrorMetadata).toEqual({ an: 'object' });
    expect(error.expoApiV2ErrorServerStack).toEqual('line 1: hello');
  });

  it('does not convert non-APIv2 error to ApiV2Error', async () => {
    nock(getExpoApiBaseUrl()).post('/v2/test').reply(500, 'Something went wrong');

    let error: Error | null = null;
    try {
      await api.postAsync('test', { body: {} });
    } catch (e: any) {
      error = e;
    }
    expect(error).not.toBeNull();
    expect(error).not.toBeInstanceOf(ApiV2Error);
  });
});
