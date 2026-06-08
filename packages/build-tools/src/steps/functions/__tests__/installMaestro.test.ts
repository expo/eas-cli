import spawn from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { Datadog } from '../../../datadog';
import { createInstallMaestroBuildFunction } from '../installMaestro';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../../datadog', () => ({
  Datadog: {
    distribution: jest.fn(),
  },
}));

const mockedSpawn = jest.mocked(spawn);

describe('createInstallMaestroBuildFunction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // `maestro --version` reports an installed version; `java -version` succeeds.
    // With no requested version and Maestro present, the step skips installation.
    mockedSpawn.mockImplementation((async (command: string) => ({
      stdout: command === 'maestro' ? '1.41.0\n' : '',
    })) as any);
  });

  it('reports the detected Maestro version to Datadog on EAS Build VMs', async () => {
    const installMaestro = createInstallMaestroBuildFunction();
    const globalCtx = createGlobalContextMock();
    globalCtx.updateEnv({ EAS_BUILD_RUNNER: 'eas-build' });
    const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, { callInputs: {} });

    await step.executeAsync();

    expect(step.getOutputValueByName('maestro_version')).toBe('1.41.0');
    expect(Datadog.distribution).toHaveBeenCalledWith('eas.maestro.install', 1, {
      maestro_version: '1.41.0',
    });
  });

  it('does not report to Datadog outside EAS Build VMs', async () => {
    const installMaestro = createInstallMaestroBuildFunction();
    const step = installMaestro.createBuildStepFromFunctionCall(createGlobalContextMock(), {
      callInputs: {},
    });

    await step.executeAsync();

    expect(Datadog.distribution).not.toHaveBeenCalled();
  });
});
