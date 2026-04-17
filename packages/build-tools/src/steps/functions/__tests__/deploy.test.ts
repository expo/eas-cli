import { BuildRuntimePlatform } from '@expo/steps';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { runEasCliCommand } from '../../../utils/easCli';
import { createEasDeployBuildFunction } from '../deploy';

jest.mock('../../../utils/easCli', () => ({
  runEasCliCommand: jest.fn(),
}));

const mockDeployStdout = JSON.stringify({
  url: 'https://example.dev',
  production: { url: 'https://example.prod' },
  aliases: [{ url: 'https://example.alias' }],
  identifier: 'abc',
  dashboardUrl: 'https://expo.dev/dashboard',
});

describe(createEasDeployBuildFunction, () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('passes deploy flags from function inputs and sets deploy_json output', async () => {
    jest.mocked(runEasCliCommand).mockResolvedValue({
      stdout: Buffer.from(mockDeployStdout),
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
    });

    const buildStep = createEasDeployBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {
        alias: 'preview-link',
        prod: true,
        source_maps: false,
      },
      env: { HOME: '/tmp/home' },
    });
    await buildStep.executeAsync();

    expect(buildStep.ctx.logger.info).toHaveBeenCalledWith(
      'Running deploy command: eas deploy --non-interactive --json --export-dir dist --alias preview-link --prod'
    );
    expect(runEasCliCommand).toHaveBeenCalledWith({
      args: [
        'deploy',
        '--non-interactive',
        '--json',
        '--export-dir',
        'dist',
        '--alias',
        'preview-link',
        '--prod',
      ],
      options: expect.objectContaining({
        cwd: buildStep.ctx.workingDirectory,
        env: expect.objectContaining({ HOME: '/tmp/home' }),
        logger: buildStep.ctx.logger,
      }),
    });
    expect(buildStep.outputById.deploy_json.value).toBe(mockDeployStdout);
    expect(buildStep.outputById.deploy_url.value).toBe('https://example.prod');
    expect(buildStep.outputById.deploy_deployment_url.value).toBe('https://example.dev');
    expect(buildStep.outputById.deploy_identifier.value).toBe('abc');
    expect(buildStep.outputById.deploy_dashboard_url.value).toBe('https://expo.dev/dashboard');
    expect(buildStep.outputById.deploy_alias_url.value).toBe('https://example.alias');
  });

  it('forwards workflow step env to the eas deploy process', async () => {
    jest.mocked(runEasCliCommand).mockResolvedValue({
      stdout: Buffer.from(mockDeployStdout),
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
    });

    const buildStep = createEasDeployBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: { source_maps: true },
      env: { HOME: '/tmp/home', EXAMPLE_WORKFLOW_ENV: 'from-workflow' },
    });
    await buildStep.executeAsync();

    expect(runEasCliCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['--source-maps']),
      })
    );
    expect(runEasCliCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          env: expect.objectContaining({
            HOME: '/tmp/home',
            EXAMPLE_WORKFLOW_ENV: 'from-workflow',
          }),
        }),
      })
    );
  });

  it('throws an actionable error message when deploy command fails', async () => {
    jest.mocked(runEasCliCommand).mockRejectedValue(new Error('deploy failed'));

    const logger = createMockLogger();
    const globalCtx = createGlobalContextMock({
      logger,
      runtimePlatform: BuildRuntimePlatform.LINUX,
    });
    const buildStep = createEasDeployBuildFunction().createBuildStepFromFunctionCall(globalCtx, {});

    let errorMessage = '';
    try {
      await buildStep.executeAsync();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain('Deploy command failed.');
    expect(errorMessage).toContain('This can happen when deploy inputs are invalid');
    expect(errorMessage).toContain(
      'Check the deploy step logs, verify your deploy configuration and exported files, then retry.'
    );
    expect(errorMessage).toContain('Original error: deploy failed');
  });

  it('passes custom export_dir to eas deploy', async () => {
    jest.mocked(runEasCliCommand).mockResolvedValue({
      stdout: Buffer.from(mockDeployStdout),
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
    });

    const buildStep = createEasDeployBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: { export_dir: 'web-build' },
    });
    await buildStep.executeAsync();

    expect(runEasCliCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['--export-dir', 'web-build']),
      })
    );
  });

  it('does not pass --source-maps when source_maps is false', async () => {
    jest.mocked(runEasCliCommand).mockResolvedValue({
      stdout: Buffer.from(mockDeployStdout),
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
    });

    const buildStep = createEasDeployBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: { source_maps: false },
    });
    await buildStep.executeAsync();

    const { args } = jest.mocked(runEasCliCommand).mock.calls[0][0];
    expect(args).not.toContain('--source-maps');
  });

  it('sets deploy_json and skips optional outputs when stdout is not valid JSON', async () => {
    jest.mocked(runEasCliCommand).mockResolvedValue({
      stdout: Buffer.from('not-json'),
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
    });

    const buildStep = createEasDeployBuildFunction().createBuildStepFromFunctionCall(globalCtx, {});
    await buildStep.executeAsync();

    expect(buildStep.outputById.deploy_json.value).toBe('not-json');
    expect(buildStep.ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      expect.stringContaining('Failed to parse')
    );
    expect(buildStep.outputById.deploy_url.value).toBeUndefined();
  });

  it('sets outputs from partial deploy JSON and leaves missing fields undefined', async () => {
    const partialDeployStdout = JSON.stringify({
      url: 'https://example.dev-only',
      dashboardUrl: 'https://expo.dev/dashboard-only',
    });
    jest.mocked(runEasCliCommand).mockResolvedValue({
      stdout: Buffer.from(partialDeployStdout),
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
    });

    const buildStep = createEasDeployBuildFunction().createBuildStepFromFunctionCall(globalCtx, {});
    await buildStep.executeAsync();

    expect(buildStep.outputById.deploy_json.value).toBe(partialDeployStdout);
    expect(buildStep.outputById.deploy_url.value).toBe('https://example.dev-only');
    expect(buildStep.outputById.deploy_deployment_url.value).toBe('https://example.dev-only');
    expect(buildStep.outputById.deploy_dashboard_url.value).toBe('https://expo.dev/dashboard-only');
    expect(buildStep.outputById.deploy_identifier.value).toBeUndefined();
    expect(buildStep.outputById.deploy_alias_url.value).toBeUndefined();
  });

  it('sets deploy_url from aliases[0].url when production is absent but aliases exist', async () => {
    const stdout = JSON.stringify({
      url: 'https://example.deployment',
      aliases: [{ url: 'https://example.alias-first' }],
      identifier: 'partial-alias',
    });
    jest.mocked(runEasCliCommand).mockResolvedValue({
      stdout: Buffer.from(stdout),
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
    });

    const buildStep = createEasDeployBuildFunction().createBuildStepFromFunctionCall(globalCtx, {});
    await buildStep.executeAsync();

    expect(buildStep.outputById.deploy_url.value).toBe('https://example.alias-first');
    expect(buildStep.outputById.deploy_deployment_url.value).toBe('https://example.deployment');
    expect(buildStep.outputById.deploy_alias_url.value).toBe('https://example.alias-first');
    expect(buildStep.outputById.deploy_identifier.value).toBe('partial-alias');
  });
});
