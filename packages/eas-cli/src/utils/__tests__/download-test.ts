import nock from 'nock';

import { getExpoApiBaseUrl } from '../../api';
import { RequestError } from '../../fetch';
import { wrapFetchWithProgress } from '../download';

describe(wrapFetchWithProgress, () => {
  const url = getExpoApiBaseUrl();

  it('returns response with body', async () => {
    nock(url)
      .get('/test-body')
      .reply(200, 'success', { 'Content-Length': String(Buffer.byteLength('success')) });

    const response = await wrapFetchWithProgress()(`${url}/test-body`, {}, jest.fn());

    expect(await response.text()).toBe('success');
  });

  it('calls progress handler when loading body', async () => {
    const testSize = 1024 * 1024; // 1MB

    nock(url)
      .get('/test-progress')
      .reply(200, Buffer.alloc(testSize), { 'Content-Length': String(testSize) });

    const progressTracker = jest.fn();
    const fetchWithProgress = wrapFetchWithProgress();
    const response = await fetchWithProgress(`${url}/test-progress`, {}, progressTracker);

    // Response should be successful
    expect(response).toMatchObject({ ok: true });
    // Load the the response body to trigger the progress events
    expect(await response.blob()).not.toBeUndefined();
    // Progress tracker should start at 0%
    expect(progressTracker).toHaveBeenCalledWith({
      isComplete: false,
      progress: {
        total: testSize,
        percent: 0,
        transferred: 0,
      },
    });
    // Progress tracker should end at 100%
    expect(progressTracker).toHaveBeenCalledWith({
      isComplete: true,
      progress: {
        total: testSize,
        percent: 1,
        transferred: testSize,
      },
    });
  });

  it('skips progress events when request fails', async () => {
    nock(url)
      .get('/test-fail')
      .reply(404, 'Not Found', { 'Content-Length': String(Buffer.byteLength('Not Found')) });

    const progressTracker = jest.fn();
    const response = await wrapFetchWithProgress()(`${url}/test-fail`, {}, progressTracker).catch(
      (requestError: RequestError) => requestError.response
    );

    // Response should not be successful
    expect(response).toMatchObject({ ok: false });
    // Repsonse should contain our error message
    expect(await response.text()).toBe('Not Found');
    // No progression events should be called
    expect(progressTracker).not.toHaveBeenCalled();
  });

  it('skips progress events when response is empty', async () => {
    nock(url).get('/test-empty').reply(204, undefined, { 'Content-Length': '0' });

    const progressTracker = jest.fn();
    const response = await wrapFetchWithProgress()(`${url}/test-empty`, {}, progressTracker);

    // Response should be successful
    expect(response).toMatchObject({ ok: true });
    // Body should be empty
    expect(await response.text()).toBe('');
    // No progression events should be called
    expect(progressTracker).not.toHaveBeenCalled();
  });

  it('skips progress events when no content-length header is available', async () => {
    nock(url).get('/test-missing-content-length').reply(200, 'success');

    const progressTracker = jest.fn();
    const response = await wrapFetchWithProgress()(
      `${url}/test-missing-content-length`,
      {},
      progressTracker
    );

    // Response should be successful
    expect(response).toMatchObject({ ok: true });
    // Body should be empty
    expect(await response.text()).toBe('success');
    // No progression events should be called
    expect(progressTracker).not.toHaveBeenCalled();
  });
});
