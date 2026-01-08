import { errors } from '@expo/steps';
import fetch, { Response } from 'node-fetch';
import { bunyan } from '@expo/logger';

import { createSendSlackMessageFunction } from '../sendSlackMessage';
import { createGlobalContextMock } from '../../../__tests__/utils/context';

jest.mock('@expo/logger');
jest.mock('node-fetch');

describe(createSendSlackMessageFunction, () => {
  const fetchMock = jest.mocked(fetch);
  const sendSlackMessage = createSendSlackMessageFunction();
  let loggerInfoMock: jest.SpyInstance;
  let loggerWarnMock: jest.SpyInstance;
  let loggerDebugMock: jest.SpyInstance;
  let loggerErrorMock: jest.SpyInstance;

  afterEach(() => {
    jest.resetAllMocks();
  });

  function mockLogger(logger: bunyan): void {
    loggerInfoMock = jest.spyOn(logger, 'info');
    loggerWarnMock = jest.spyOn(logger, 'warn');
    loggerDebugMock = jest.spyOn(logger, 'debug');
    loggerErrorMock = jest.spyOn(logger, 'error');
  }

  it('calls the default webhook defined in SLACK_HOOK_URL secret and logs the info messages when successful', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ status: 200, ok: true } as Response));
    const buildStep = sendSlackMessage.createBuildStepFromFunctionCall(
      createGlobalContextMock({}),
      {
        callInputs: {
          message: 'Test message',
        },
        env: {
          SLACK_HOOK_URL: 'https://slack.hook.url',
        },
        id: sendSlackMessage.id,
      }
    );
    mockLogger(buildStep.ctx.logger);
    await buildStep.executeAsync();
    expect(fetchMock).toHaveBeenCalledWith('https://slack.hook.url', {
      method: 'POST',
      body: JSON.stringify({ text: 'Test message' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loggerInfoMock).toHaveBeenCalledTimes(4);
    expect(loggerInfoMock).toHaveBeenCalledWith('Sending Slack message');
    expect(loggerInfoMock).toHaveBeenCalledWith('Slack message sent successfully');
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('calls the webhook when using multiline plain text input', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ status: 200, ok: true } as Response));
    const buildStep = sendSlackMessage.createBuildStepFromFunctionCall(
      createGlobalContextMock({}),
      {
        callInputs: {
          message: 'Line 1\nLine 2\n\nLine 3',
        },
        env: {
          SLACK_HOOK_URL: 'https://slack.hook.url',
        },
        id: sendSlackMessage.id,
      }
    );
    mockLogger(buildStep.ctx.logger);
    await buildStep.executeAsync();
    expect(fetchMock).toHaveBeenCalledWith('https://slack.hook.url', {
      method: 'POST',
      body: '{"text":"Line 1\\nLine 2\\n\\nLine 3"}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loggerInfoMock).toHaveBeenCalledTimes(4);
    expect(loggerInfoMock).toHaveBeenCalledWith('Sending Slack message');
    expect(loggerInfoMock).toHaveBeenCalledWith('Slack message sent successfully');
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('calls the webhook when using multiline plain text input with doubly escaped new lines', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ status: 200, ok: true } as Response));
    const buildStep = sendSlackMessage.createBuildStepFromFunctionCall(
      createGlobalContextMock({}),
      {
        callInputs: {
          message: 'Line 1\\nLine 2\\n\\nLine 3',
        },
        env: {
          SLACK_HOOK_URL: 'https://slack.hook.url',
        },
        id: sendSlackMessage.id,
      }
    );
    mockLogger(buildStep.ctx.logger);
    await buildStep.executeAsync();
    expect(fetchMock).toHaveBeenCalledWith('https://slack.hook.url', {
      method: 'POST',
      body: '{"text":"Line 1\\nLine 2\\n\\nLine 3"}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loggerInfoMock).toHaveBeenCalledTimes(4);
    expect(loggerInfoMock).toHaveBeenCalledWith('Sending Slack message');
    expect(loggerInfoMock).toHaveBeenCalledWith('Slack message sent successfully');
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('calls the webhook when using the payload input', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ status: 200, ok: true } as Response));
    const buildStep = sendSlackMessage.createBuildStepFromFunctionCall(
      createGlobalContextMock({}),
      {
        callInputs: {
          payload: { blocks: [] },
        },
        env: {
          SLACK_HOOK_URL: 'https://slack.hook.url',
        },
        id: sendSlackMessage.id,
      }
    );
    mockLogger(buildStep.ctx.logger);
    await buildStep.executeAsync();
    expect(fetchMock).toHaveBeenCalledWith('https://slack.hook.url', {
      method: 'POST',
      body: JSON.stringify({ blocks: [] }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loggerInfoMock).toHaveBeenCalledTimes(4);
    expect(loggerInfoMock).toHaveBeenCalledWith('Sending Slack message');
    expect(loggerInfoMock).toHaveBeenCalledWith('Slack message sent successfully');
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('calls the webhook provided as input overwriting SLACK_HOOK_URL secret and logs the info messages when successful', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ status: 200, ok: true } as Response));
    const buildStep = sendSlackMessage.createBuildStepFromFunctionCall(
      createGlobalContextMock({}),
      {
        callInputs: {
          message: 'Test message',
          slack_hook_url: 'https://another.slack.hook.url',
        },
        env: {
          SLACK_HOOK_URL: 'https://slack.hook.url',
        },
        id: sendSlackMessage.id,
      }
    );
    mockLogger(buildStep.ctx.logger);
    await buildStep.executeAsync();
    expect(fetchMock).toHaveBeenCalledWith('https://another.slack.hook.url', {
      method: 'POST',
      body: JSON.stringify({ text: 'Test message' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loggerInfoMock).toHaveBeenCalledTimes(4);
    expect(loggerInfoMock).toHaveBeenCalledWith('Sending Slack message');
    expect(loggerInfoMock).toHaveBeenCalledWith('Slack message sent successfully');
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('calls the webhook provided as reference to specific env variable, overwriting SLACK_HOOK_URL secret and logs the info messages when successful', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ status: 200, ok: true } as Response));
    const ctx = createGlobalContextMock();
    ctx.updateEnv({
      ANOTHER_SLACK_HOOK_URL: 'https://another.slack.hook.url',
    });
    const buildStep = sendSlackMessage.createBuildStepFromFunctionCall(ctx, {
      callInputs: {
        message: 'Test message',
        slack_hook_url: '${ eas.env.ANOTHER_SLACK_HOOK_URL }',
      },
      env: {
        SLACK_HOOK_URL: 'https://slack.hook.url',
      },
      id: sendSlackMessage.id,
    });
    mockLogger(buildStep.ctx.logger);
    await buildStep.executeAsync();
    expect(fetchMock).toHaveBeenCalledWith('https://another.slack.hook.url', {
      method: 'POST',
      body: JSON.stringify({ text: 'Test message' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loggerInfoMock).toHaveBeenCalledTimes(4);
    expect(loggerInfoMock).toHaveBeenCalledWith('Sending Slack message');
    expect(loggerInfoMock).toHaveBeenCalledWith('Slack message sent successfully');
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('calls the webhook provided as reference to specific env variable, overwriting SLACK_HOOK_URL secret and logs the info messages when successful', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ status: 200, ok: true } as Response));
    const ctx = createGlobalContextMock();
    ctx.updateEnv({
      ANOTHER_SLACK_HOOK_URL: 'https://another.slack.hook.url',
    });
    const buildStep = sendSlackMessage.createBuildStepFromFunctionCall(ctx, {
      callInputs: {
        message: 'Test message',
        slack_hook_url: '${{ env.ANOTHER_SLACK_HOOK_URL }}',
      },
      env: {
        SLACK_HOOK_URL: 'https://slack.hook.url',
      },
      id: sendSlackMessage.id,
    });
    mockLogger(buildStep.ctx.logger);
    await buildStep.executeAsync();
    expect(fetchMock).toHaveBeenCalledWith('https://another.slack.hook.url', {
      method: 'POST',
      body: JSON.stringify({ text: 'Test message' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loggerInfoMock).toHaveBeenCalledTimes(4);
    expect(loggerInfoMock).toHaveBeenCalledWith('Sending Slack message');
    expect(loggerInfoMock).toHaveBeenCalledWith('Slack message sent successfully');
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('does not call the webhook when no url specified', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ status: 200, ok: true } as Response));
    const buildStep = sendSlackMessage.createBuildStepFromFunctionCall(
      createGlobalContextMock({}),
      {
        callInputs: {
          message: 'Test message',
        },
        env: {},
        id: sendSlackMessage.id,
      }
    );
    mockLogger(buildStep.ctx.logger);
    const expectedError = new errors.BuildStepRuntimeError(
      'Sending Slack message failed - provide input "slack_hook_url" or set "SLACK_HOOK_URL" secret'
    );
    await expect(buildStep.executeAsync()).rejects.toThrow(expectedError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerInfoMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Slack webhook URL not provided - provide input "slack_hook_url" or set "SLACK_HOOK_URL" secret'
    );
  });

  it('does not call the webhook when no message or payload specified', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ status: 200, ok: true } as Response));
    const buildStep = sendSlackMessage.createBuildStepFromFunctionCall(
      createGlobalContextMock({}),
      {
        callInputs: {},
        env: {
          SLACK_HOOK_URL: 'https://slack.hook.url',
        },
        id: sendSlackMessage.id,
      }
    );
    mockLogger(buildStep.ctx.logger);
    const expectedError = new errors.BuildStepRuntimeError(
      `You need to provide either "message" input or "payload" input to specify the Slack message contents`
    );
    await expect(buildStep.executeAsync()).rejects.toThrow(expectedError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerInfoMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('does not call the webhook when both message and payload are specified', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ status: 200, ok: true } as Response));
    const buildStep = sendSlackMessage.createBuildStepFromFunctionCall(
      createGlobalContextMock({}),
      {
        callInputs: {
          message: 'Test message',
          payload: { blocks: [] },
        },
        env: {
          SLACK_HOOK_URL: 'https://slack.hook.url',
        },
        id: sendSlackMessage.id,
      }
    );
    mockLogger(buildStep.ctx.logger);
    const expectedError = new errors.BuildStepRuntimeError(
      `You cannot specify both "message" input and "payload" input - choose one for the Slack message contents`
    );
    await expect(buildStep.executeAsync()).rejects.toThrow(expectedError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerInfoMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('catches error if thrown, logs warning and details in debug, throws new error', async () => {
    const thrownError = new Error('Request failed');
    fetchMock.mockImplementation(() => {
      throw thrownError;
    });
    const buildStep = sendSlackMessage.createBuildStepFromFunctionCall(
      createGlobalContextMock({}),
      {
        callInputs: {
          message: 'Test message',
        },
        env: {
          SLACK_HOOK_URL: 'https://slack.hook.url',
        },
        id: sendSlackMessage.id,
      }
    );
    mockLogger(buildStep.ctx.logger);
    const expectedError = new Error(
      'Sending Slack message to webhook url "https://slack.hook.url" failed'
    );
    await expect(buildStep.executeAsync()).rejects.toThrow(expectedError);
    expect(fetchMock).toHaveBeenCalledWith('https://slack.hook.url', {
      method: 'POST',
      body: JSON.stringify({ text: 'Test message' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loggerInfoMock).toHaveBeenCalledTimes(2);
    expect(loggerInfoMock).toHaveBeenCalledWith('Sending Slack message');
    expect(loggerWarnMock).not.toHaveBeenCalled();
    expect(loggerDebugMock).toHaveBeenCalledWith(thrownError);
    expect(loggerErrorMock).toHaveBeenCalledWith({
      err: expectedError,
    });
  });

  it.each([
    [400, 'Bad request'],
    [500, 'Internal server error'],
  ])(
    'handles %s error status code, logs warning and details in debug, throws new error',
    async (statusCode, statusText) => {
      fetchMock.mockImplementation(() =>
        Promise.resolve({ status: statusCode, ok: false, statusText } as Response)
      );
      const buildStep = sendSlackMessage.createBuildStepFromFunctionCall(
        createGlobalContextMock({}),
        {
          callInputs: {
            message: 'Test message',
          },
          env: {
            SLACK_HOOK_URL: 'https://slack.hook.url',
          },
          id: sendSlackMessage.id,
        }
      );
      mockLogger(buildStep.ctx.logger);
      const expectedError = new Error(
        `Sending Slack message to webhook url "https://slack.hook.url" failed with status ${statusCode}`
      );
      await expect(buildStep.executeAsync()).rejects.toThrow(expectedError);
      expect(fetchMock).toHaveBeenCalledWith('https://slack.hook.url', {
        method: 'POST',
        body: JSON.stringify({ text: 'Test message' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(loggerInfoMock).toHaveBeenCalledTimes(2);
      expect(loggerInfoMock).toHaveBeenCalledWith('Sending Slack message');
      expect(loggerWarnMock).not.toHaveBeenCalled();
      expect(loggerDebugMock).toHaveBeenCalledWith(`${statusCode} - ${statusText}`);
      expect(loggerErrorMock).toHaveBeenCalledWith({
        err: expectedError,
      });
    }
  );
});
