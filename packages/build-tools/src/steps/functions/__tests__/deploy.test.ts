jest.mock('@expo/steps', () => {
  const actual = jest.requireActual('@expo/steps');
  return {
    ...actual,
    spawnAsync: jest.fn(),
  };
});

import { BuildRuntimePlatform, spawnAsync } from '@expo/steps';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { runEasCliCommand } from '../../../utils/easCli';
import { createEasDeployBuildFunction } from '../deploy';

jest.mock('../../../utils/easCli', () => ({
  runEasCliCommand: jest.fn(),
}));

describe(createEasDeployBuildFunction, () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(spawnAsync).mockResolvedValue({} as any);
  });

  it('passes deploy flags from function inputs and sets deploy_json output', async () => {
    jest.mocked(runEasCliCommand).mockResolvedValue({
      stdout: Buffer.from('{"url":"https://example.dev"}'),
      stderr: Buffer.from(''),
      pid: 1,
      output: [],
      status: 0,
      signal: null,
      error: null,
    } as any);

    const logger = createMockLogger();
    const globalCtx = createGlobalContextMock({
      logger,
      runtimePlatform: BuildRuntimePlatform.LINUX,
      staticContextContent: {
        metadata: {
          environment: 'production',
        },
      },
    });

    const buildStep = createEasDeployBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {
        alias: 'preview-link',
        prod: true,
        source_maps: false,
        export_command: 'echo exported',
      },
      env: { HOME: '/tmp/home' },
    });
    await buildStep.executeAsync();

    expect(buildStep.ctx.logger.info).toHaveBeenCalledWith('Running export command: echo exported');
    expect(buildStep.ctx.logger.info).toHaveBeenCalledWith(
      'Running deploy command: eas deploy --non-interactive --json --environment production --alias preview-link --prod --no-source-maps'
    );
    expect(spawnAsync).toHaveBeenCalledWith('sh', ['-c', 'echo exported'], {
      cwd: buildStep.ctx.workingDirectory,
      env: expect.objectContaining({ HOME: '/tmp/home' }),
      logger: buildStep.ctx.logger,
      stdio: 'pipe',
    });
    expect(runEasCliCommand).toHaveBeenCalledWith({
      args: [
        'deploy',
        '--non-interactive',
        '--json',
        '--environment',
        'production',
        '--alias',
        'preview-link',
        '--prod',
        '--no-source-maps',
      ],
      options: expect.objectContaining({
        cwd: buildStep.ctx.workingDirectory,
        env: expect.objectContaining({ HOME: '/tmp/home' }),
        logger: buildStep.ctx.logger,
      }),
    });
    expect(buildStep.outputById.deploy_json.value).toBe('{"url":"https://example.dev"}');
  });

  it('uses metadata environment when available', async () => {
    jest.mocked(runEasCliCommand).mockResolvedValue({
      stdout: Buffer.from('{"url":"https://example.dev"}'),
      stderr: Buffer.from(''),
      pid: 1,
      output: [],
      status: 0,
      signal: null,
      error: null,
    } as any);

    const logger = createMockLogger();
    const globalCtx = createGlobalContextMock({
      logger,
      runtimePlatform: BuildRuntimePlatform.LINUX,
      staticContextContent: {
        metadata: {
          environment: 'preview',
        },
      },
    });

    const buildStep = createEasDeployBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {
        source_maps: true,
        export_command: 'echo exported',
      },
    });
    await buildStep.executeAsync();

    expect(runEasCliCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['--environment', 'preview', '--source-maps']),
      })
    );
  });

  it('throws with deploy phase in error message when deploy command fails', async () => {
    jest.mocked(runEasCliCommand).mockRejectedValue(new Error('deploy failed'));

    const logger = createMockLogger();
    const globalCtx = createGlobalContextMock({
      logger,
      runtimePlatform: BuildRuntimePlatform.LINUX,
    });
    const buildStep = createEasDeployBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {
        export_command: 'echo exported',
      },
    });

    await expect(buildStep.executeAsync()).rejects.toThrow(
      'Deploy command failed: deploy failed'
    );
  });

  it('throws with export phase in error message when export command fails', async () => {
    jest.mocked(spawnAsync).mockRejectedValue(new Error('export failed'));

    const logger = createMockLogger();
    const globalCtx = createGlobalContextMock({
      logger,
      runtimePlatform: BuildRuntimePlatform.LINUX,
    });

    const buildStep = createEasDeployBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {
        export_command: 'echo exported',
      },
    });

    await expect(buildStep.executeAsync()).rejects.toThrow(
      'Export command failed: export failed'
    );
    expect(runEasCliCommand).not.toHaveBeenCalled();
  });
});
