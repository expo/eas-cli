import nock from 'nock';

import { makeUserMessage, streamChatResponseAsync } from '../chatClient';

const mockSpinners: { isSpinning: boolean; text: string }[] = [];

jest.mock('../../log');
jest.mock('../../ora', () => ({
  ora: () => {
    const spinner = {
      isSpinning: true,
      text: '',
      start: () => spinner,
      stop: () => {
        spinner.isSpinning = false;
        return spinner;
      },
    };
    mockSpinners.push(spinner);
    return spinner;
  },
}));

const WEBSITE_ORIGIN = 'https://expo.dev';

function sseBody(frames: object[]): string {
  return [...frames.map(frame => `data: ${JSON.stringify(frame)}`), 'data: [DONE]', ''].join(
    '\n\n'
  );
}

describe(streamChatResponseAsync, () => {
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    nock.cleanAll();
    mockSpinners.length = 0;
    writeSpy = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('streams text deltas to stdout and returns the full text', async () => {
    nock(WEBSITE_ORIGIN)
      .post('/api/chat')
      .reply(
        200,
        sseBody([
          { type: 'start' },
          { type: 'tool-input-available', toolCallId: 't1', toolName: 'get_latest_builds' },
          { type: 'text-start', id: '0' },
          { type: 'text-delta', id: '0', delta: 'Your latest ' },
          { type: 'text-delta', id: '0', delta: 'build passed.' },
          { type: 'finish' },
        ]),
        { 'content-type': 'text/event-stream' }
      );

    const result = await streamChatResponseAsync({
      messages: [makeUserMessage('how are my builds?')],
      accountName: 'my-account',
      sessionSecret: '{"id":"session-id","version":"1"}',
      stream: true,
    });

    const written = writeSpy.mock.calls.map(call => call[0]).join('');
    expect(written).toContain('Your latest ');
    expect(written).toContain('build passed.');
    expect(result.text).toBe('Your latest build passed.');
  });

  it('keeps the spinner active until a full line is ready instead of clearing it on the first delta', async () => {
    nock(WEBSITE_ORIGIN)
      .post('/api/chat')
      .reply(
        200,
        sseBody([
          { type: 'text-start', id: '0' },
          { type: 'text-delta', id: '0', delta: 'Looking good' },
          { type: 'tool-input-available', toolCallId: 't1', toolName: 'get_latest_builds' },
          { type: 'text-delta', id: '0', delta: ' so far.' },
          { type: 'finish' },
        ]),
        { 'content-type': 'text/event-stream' }
      );

    const result = await streamChatResponseAsync({
      messages: [makeUserMessage('how are my builds?')],
      accountName: 'my-account',
      sessionSecret: '{"id":"abc","version":"1"}',
      stream: true,
    });

    const written = writeSpy.mock.calls.map(call => call[0]).join('');
    // No newline arrives until the end, so nothing is flushed mid-stream: the tool activity
    // is shown on the still-running spinner rather than being printed inline.
    expect(mockSpinners[0].text).toContain('Looking up builds');
    expect(written).not.toContain('Looking up builds');
    // The buffered text is rendered in one go once the response completes.
    expect(written).toContain('Looking good so far.');
    expect(result.text).toBe('Looking good so far.');
  });

  it('captures tool calls with inputs and outputs without writing to stdout when not streaming', async () => {
    nock(WEBSITE_ORIGIN)
      .post('/api/chat')
      .reply(
        200,
        sseBody([
          { type: 'start-step' },
          {
            type: 'tool-input-available',
            toolCallId: 't1',
            toolName: 'get_latest_builds',
            input: { limit: 1 },
          },
          { type: 'tool-output-available', toolCallId: 't1', output: { builds: ['b1'] } },
          { type: 'finish-step' },
          { type: 'start-step' },
          { type: 'text-delta', delta: 'Done.' },
          { type: 'finish-step' },
          { type: 'finish' },
        ])
      );

    const result = await streamChatResponseAsync({
      messages: [makeUserMessage('builds?')],
      accountName: 'my-account',
      sessionSecret: '{"id":"abc","version":"1"}',
      stream: false,
    });

    expect(writeSpy).not.toHaveBeenCalled();
    expect(result.text).toBe('Done.');
    expect(result.toolCalls).toEqual([
      {
        toolName: 'get_latest_builds',
        input: { limit: 1 },
        output: { builds: ['b1'] },
        errorText: undefined,
      },
    ]);
    expect(result.assistantMessage).toEqual(
      expect.objectContaining({
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          {
            type: 'tool-get_latest_builds',
            toolCallId: 't1',
            state: 'output-available',
            input: { limit: 1 },
            output: { builds: ['b1'] },
          },
          { type: 'step-start' },
          { type: 'text', text: 'Done.' },
        ],
      })
    );
  });

  it('sends the session secret as a cookie and the account as a header', async () => {
    let capturedHeaders: Record<string, string | string[]> = {};
    let capturedBody: any;
    nock(WEBSITE_ORIGIN)
      .post('/api/chat')
      .reply(function (_uri, body) {
        capturedHeaders = this.req.headers;
        capturedBody = body;
        return [200, sseBody([{ type: 'text-delta', delta: 'hi' }])];
      });

    await streamChatResponseAsync({
      messages: [makeUserMessage('hello')],
      accountName: 'my-account',
      sessionSecret: '{"id":"abc","version":"1"}',
      stream: false,
    });

    const cookie = [capturedHeaders.cookie].flat().join('; ');
    expect(cookie).toContain('io.expo.auth.sessionSecret=');
    expect(cookie).toContain(encodeURIComponent('{"id":"abc","version":"1"}'));
    expect([capturedHeaders['x-account-name']].flat()[0]).toBe('my-account');
    expect(capturedBody.messages[0].role).toBe('system');
    expect(capturedBody.messages[0].parts[0].text).toContain('https://expo.dev');
    expect(capturedBody.messages[1]).toEqual(
      expect.objectContaining({ role: 'user', parts: [{ type: 'text', text: 'hello' }] })
    );
  });

  it('maps a 429 response to a usage-limit error', async () => {
    nock(WEBSITE_ORIGIN).post('/api/chat').reply(429, 'Chat usage limit reached');

    await expect(
      streamChatResponseAsync({
        messages: [makeUserMessage('hello')],
        accountName: 'my-account',
        sessionSecret: '{"id":"abc","version":"1"}',
        stream: false,
      })
    ).rejects.toThrow(/usage limit/);
  });

  it('maps a 403 response to a not-enabled error', async () => {
    nock(WEBSITE_ORIGIN).post('/api/chat').reply(403, 'Forbidden');

    await expect(
      streamChatResponseAsync({
        messages: [makeUserMessage('hello')],
        accountName: 'my-account',
        sessionSecret: '{"id":"abc","version":"1"}',
        stream: false,
      })
    ).rejects.toThrow(/not enabled/);
  });
});
