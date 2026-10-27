import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { parseAndReportXcactivitylog } from '../../utils/ios/xcactivitylog';
import { parseXcactivitylogFunction } from '../parseXcactivitylog';

jest.mock('../../utils/ios/xcactivitylog');

describe(parseXcactivitylogFunction, () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('passes proxyBaseUrl from env into parseAndReportXcactivitylog', async () => {
    const globalContext = createGlobalContextMock({ logger: createMockLogger() });
    globalContext.updateEnv({ EAS_BUILD_COCOAPODS_CACHE_URL: 'https://cache.example.com' });

    const buildStep = parseXcactivitylogFunction().createBuildStepFromFunctionCall(globalContext);

    await buildStep.executeAsync();

    expect(parseAndReportXcactivitylog).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyBaseUrl: 'https://cache.example.com',
      })
    );
  });

  it('passes xclogparserVersion as undefined when the input is not provided', async () => {
    const globalContext = createGlobalContextMock({ logger: createMockLogger() });

    const buildStep = parseXcactivitylogFunction().createBuildStepFromFunctionCall(globalContext);

    await buildStep.executeAsync();

    expect(parseAndReportXcactivitylog).toHaveBeenCalledWith(
      expect.objectContaining({
        xclogparserVersion: undefined,
      })
    );
  });

  it('resolves derived_data_path and workspace_path inputs against stepCtx.workingDirectory', async () => {
    const globalContext = createGlobalContextMock({ logger: createMockLogger() });

    const buildStep = parseXcactivitylogFunction().createBuildStepFromFunctionCall(globalContext, {
      callInputs: {
        derived_data_path: 'my-app/ios/Build',
        workspace_path: 'my-app/ios',
      },
    });

    await buildStep.executeAsync();

    expect(parseAndReportXcactivitylog).toHaveBeenCalledWith(
      expect.objectContaining({
        derivedDataPath: expect.stringMatching(/\/my-app\/ios\/Build$/),
        workspacePath: expect.stringMatching(/\/my-app\/ios$/),
      })
    );
  });

  it('accepts absolute paths for derived_data_path and workspace_path', async () => {
    const globalContext = createGlobalContextMock({ logger: createMockLogger() });

    const buildStep = parseXcactivitylogFunction().createBuildStepFromFunctionCall(globalContext, {
      callInputs: {
        derived_data_path: '/abs/derived',
        workspace_path: '/abs/workspace',
      },
    });

    await buildStep.executeAsync();

    expect(parseAndReportXcactivitylog).toHaveBeenCalledWith(
      expect.objectContaining({
        derivedDataPath: '/abs/derived',
        workspacePath: '/abs/workspace',
      })
    );
  });
});
