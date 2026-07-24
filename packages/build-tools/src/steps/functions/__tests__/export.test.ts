jest.mock('../../../utils/project', () => ({
  runExpoCliCommand: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../../utils/packageManager', () => ({
  ...jest.requireActual('../../../utils/packageManager'),
  resolvePackageManager: jest.fn(),
}));

import { BuildRuntimePlatform } from '@expo/steps';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { PackageManager, resolvePackageManager } from '../../../utils/packageManager';
import { runExpoCliCommand } from '../../../utils/project';
import { createEasExportBuildFunction } from '../export';

describe(createEasExportBuildFunction, () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(resolvePackageManager).mockReturnValue(PackageManager.NPM);
    jest.mocked(runExpoCliCommand).mockResolvedValue({} as any);
  });

  it('runs expo export via runExpoCliCommand with default output_dir and platform web', async () => {
    const logger = createMockLogger();
    const globalCtx = createGlobalContextMock({
      logger,
      runtimePlatform: BuildRuntimePlatform.LINUX,
    });

    const buildStep = createEasExportBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      env: { HOME: '/tmp/home' },
    });
    await buildStep.executeAsync();

    expect(buildStep.ctx.logger.info).toHaveBeenCalledWith(
      'Running export command: expo export --output-dir dist --platform web'
    );
    expect(runExpoCliCommand).toHaveBeenCalledWith({
      packageManager: PackageManager.NPM,
      args: ['export', '--output-dir', 'dist', '--platform', 'web'],
      options: {
        cwd: buildStep.ctx.workingDirectory,
        env: expect.objectContaining({ HOME: '/tmp/home' }),
        logger: buildStep.ctx.logger,
        stdio: 'pipe',
      },
    });
    expect(buildStep.outputById.export_dir.value).toBe('dist');
  });

  it('passes optional flags matching expo export CLI', async () => {
    const logger = createMockLogger();
    const globalCtx = createGlobalContextMock({
      logger,
      runtimePlatform: BuildRuntimePlatform.LINUX,
    });

    const buildStep = createEasExportBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {
        output_dir: 'web-out',
        dev: true,
        minify: false,
        dump_assetmap: true,
        ssg: false,
        api_only: true,
        platform: 'web',
      },
    });
    await buildStep.executeAsync();

    expect(runExpoCliCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          'export',
          '--output-dir',
          'web-out',
          '--platform',
          'web',
          '--dev',
          '--no-minify',
          '--dump-assetmap',
          '--no-ssg',
          '--api-only',
        ],
      })
    );
    expect(buildStep.outputById.export_dir.value).toBe('web-out');
  });

  it('uses resolved package manager (e.g. yarn)', async () => {
    jest.mocked(resolvePackageManager).mockReturnValue(PackageManager.YARN);

    const logger = createMockLogger();
    const globalCtx = createGlobalContextMock({
      logger,
      runtimePlatform: BuildRuntimePlatform.LINUX,
    });

    const buildStep = createEasExportBuildFunction().createBuildStepFromFunctionCall(globalCtx, {});
    await buildStep.executeAsync();

    expect(runExpoCliCommand).toHaveBeenCalledWith(
      expect.objectContaining({ packageManager: PackageManager.YARN })
    );
  });

  it('throws when export command fails', async () => {
    jest.mocked(runExpoCliCommand).mockRejectedValue(new Error('export failed'));

    const logger = createMockLogger();
    const globalCtx = createGlobalContextMock({
      logger,
      runtimePlatform: BuildRuntimePlatform.LINUX,
    });

    const buildStep = createEasExportBuildFunction().createBuildStepFromFunctionCall(globalCtx, {});

    await expect(buildStep.executeAsync()).rejects.toThrow('Export command failed: export failed');
  });
});
