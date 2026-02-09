import { spawnAsync } from '@expo/steps';
import { vol } from 'memfs';
import os from 'os';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { findMaestroPathsFlowsToExecuteAsync } from '../../../utils/findMaestroPathsFlowsToExecuteAsync';
import { createInternalEasMaestroTestFunction } from '../internalMaestroTest';

jest.mock('@expo/steps', () => ({
  ...jest.requireActual('@expo/steps'),
  spawnAsync: jest.fn(),
}));

jest.mock('../../../utils/IosSimulatorUtils');
jest.mock('../../../utils/AndroidEmulatorUtils');
jest.mock('../../../utils/findMaestroPathsFlowsToExecuteAsync');

const mockedSpawnAsync = jest.mocked(spawnAsync);
const mockedIosUtils = jest.mocked(IosSimulatorUtils);
const mockedFindFlows = jest.mocked(findMaestroPathsFlowsToExecuteAsync);

describe(createInternalEasMaestroTestFunction, () => {
  const mockUploadArtifact = jest.fn();

  beforeEach(() => {
    vol.mkdirSync(os.tmpdir(), { recursive: true });

    mockedSpawnAsync.mockResolvedValue(undefined as any);
    mockUploadArtifact.mockResolvedValue({ artifactId: null });

    mockedIosUtils.getAvailableDevicesAsync.mockResolvedValue([
      { name: 'iPhone 15', udid: 'test-udid-123' } as any,
    ]);
    mockedIosUtils.cloneAsync.mockResolvedValue(undefined as any);
    mockedIosUtils.startAsync.mockResolvedValue({ udid: 'cloned-udid' } as any);
    mockedIosUtils.waitForReadyAsync.mockResolvedValue(undefined as any);
    mockedIosUtils.collectLogsAsync.mockResolvedValue({ outputPath: '/tmp/logs.txt' } as any);
    mockedIosUtils.deleteAsync.mockResolvedValue(undefined as any);

    mockedFindFlows.mockResolvedValue(['/project/.maestro/home.yml']);
  });

  function createStep(overrides?: { callInputs?: Record<string, unknown> }) {
    const ctx = {
      runtimeApi: { uploadArtifact: mockUploadArtifact },
    };
    const fn = createInternalEasMaestroTestFunction(ctx as any);
    return fn.createBuildStepFromFunctionCall(
      createGlobalContextMock({
        logger: createMockLogger(),
      }),
      {
        callInputs: {
          platform: 'ios',
          flow_paths: JSON.stringify(['.maestro']),
          ...overrides?.callInputs,
        },
      }
    );
  }

  it('sets junit_report_directory output when output_format is junit', async () => {
    const step = createStep({
      callInputs: { output_format: 'junit' },
    });
    await step.executeAsync();

    const junitDir = step.getOutputValueByName('junit_report_directory');
    expect(junitDir).toMatch(/maestro-reports-/);
  });

  it('does not set junit_report_directory output when output_format is not junit', async () => {
    const step = createStep();
    await step.executeAsync();

    const junitDir = step.getOutputValueByName('junit_report_directory');
    expect(junitDir).toBeUndefined();
  });

  it('does not set junit_report_directory when function throws before reaching output code', async () => {
    mockedIosUtils.getAvailableDevicesAsync.mockResolvedValue([]);

    const step = createStep({
      callInputs: { output_format: 'junit' },
    });

    try {
      await step.executeAsync();
    } catch {
      // Expected - no booted device found
    }

    const junitDir = step.getOutputValueByName('junit_report_directory');
    expect(junitDir).toBeUndefined();
  });
});
