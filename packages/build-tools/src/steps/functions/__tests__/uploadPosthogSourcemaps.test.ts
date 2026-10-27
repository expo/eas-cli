import { PipeMode } from '@expo/logger';
import spawn from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createUploadPosthogSourcemapsFunction } from '../uploadPosthogSourcemaps';

jest.mock('@expo/logger');
jest.mock('@expo/turtle-spawn');

const spawnMock = jest.mocked(spawn);

const ENV = {
  POSTHOG_CLI_API_KEY: 'phx_test',
  POSTHOG_CLI_PROJECT_ID: '123',
  POSTHOG_CLI_HOST: 'https://us.posthog.com',
};

describe(createUploadPosthogSourcemapsFunction, () => {
  const uploadSourcemaps = createUploadPosthogSourcemapsFunction();

  afterEach(() => {
    jest.resetAllMocks();
  });

  function createStep(
    callInputs: Record<string, unknown> = {},
    env: Record<string, string> = ENV
  ): ReturnType<typeof uploadSourcemaps.createBuildStepFromFunctionCall> {
    return uploadSourcemaps.createBuildStepFromFunctionCall(createGlobalContextMock({}), {
      callInputs,
      env,
      id: uploadSourcemaps.id,
    });
  }

  it('runs @posthog/cli hermes upload with the resolved credentials and host', async () => {
    spawnMock.mockResolvedValue({ stdout: '', stderr: '' } as unknown as Awaited<
      ReturnType<typeof spawn>
    >);
    const step = createStep();

    await step.executeAsync();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe('npx');
    expect(args).toEqual([
      '-y',
      '@posthog/cli',
      '--host',
      'https://us.posthog.com',
      'hermes',
      'upload',
      '--directory',
      'dist',
    ]);
    expect(options?.env).toMatchObject({
      POSTHOG_CLI_API_KEY: 'phx_test',
      POSTHOG_CLI_PROJECT_ID: '123',
    });
    expect(options?.mode).toBe(PipeMode.COMBINED_AS_STDOUT);
  });

  it('passes a custom host through to --host', async () => {
    spawnMock.mockResolvedValue({ stdout: '', stderr: '' } as unknown as Awaited<
      ReturnType<typeof spawn>
    >);
    const step = createStep({}, { ...ENV, POSTHOG_CLI_HOST: 'https://eu.i.posthog.com' });

    await step.executeAsync();

    expect(spawnMock.mock.calls[0][1]).toEqual([
      '-y',
      '@posthog/cli',
      '--host',
      'https://eu.i.posthog.com',
      'hermes',
      'upload',
      '--directory',
      'dist',
    ]);
  });

  it('uploads the given directory', async () => {
    spawnMock.mockResolvedValue({ stdout: '', stderr: '' } as unknown as Awaited<
      ReturnType<typeof spawn>
    >);
    const step = createStep({ directory: 'build-output' });

    await step.executeAsync();

    expect(spawnMock.mock.calls[0][1]).toEqual([
      '-y',
      '@posthog/cli',
      '--host',
      'https://us.posthog.com',
      'hermes',
      'upload',
      '--directory',
      'build-output',
    ]);
  });

  it('throws when credentials are missing by default', async () => {
    const step = createStep({}, {});

    await expect(step.executeAsync()).rejects.toThrow(
      /Missing PostHog credentials: personal API key, project id/
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('warns and skips when credentials are missing and ignore_error is set', async () => {
    const step = createStep({ ignore_error: true }, {});
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await step.executeAsync();

    expect(spawnMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringMatching(/Ignoring error/)
    );
  });

  it('throws when the upload fails by default', async () => {
    spawnMock.mockRejectedValue(new Error('upload failed'));
    const step = createStep();

    await expect(step.executeAsync()).rejects.toThrow(/Uploading source maps to PostHog failed/);
  });

  it('warns and continues when the upload fails and ignore_error is set', async () => {
    spawnMock.mockRejectedValue(new Error('upload failed'));
    const step = createStep({ ignore_error: true });
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await expect(step.executeAsync()).resolves.not.toThrow();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringMatching(/Ignoring error/)
    );
  });
});
