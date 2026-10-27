import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { readAndLogPackageJson } from '../../../utils/project';
import { createReadPackageJsonBuildFunction } from '../readPackageJson';

jest.mock('../../../utils/project');

describe(createReadPackageJsonBuildFunction, () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('logs package.json contents', async () => {
    const stepLogger = createMockLogger();
    const logger = createMockLogger();
    logger.child = jest.fn().mockReturnValue(stepLogger);
    const globalContext = createGlobalContextMock({ logger });
    const buildStep =
      createReadPackageJsonBuildFunction().createBuildStepFromFunctionCall(globalContext);
    jest.mocked(readAndLogPackageJson).mockReturnValue({ name: 'app', version: '1.0.0' });

    await buildStep.executeAsync();

    expect(readAndLogPackageJson).toHaveBeenCalledWith(
      stepLogger,
      globalContext.defaultWorkingDirectory
    );
    expect(buildStep.outputById.package_json.value).toBe(
      JSON.stringify({ name: 'app', version: '1.0.0' })
    );
  });

  it('does not throw if reading package.json fails', async () => {
    const stepLogger = createMockLogger();
    const logger = createMockLogger();
    logger.child = jest.fn().mockReturnValue(stepLogger);
    const globalContext = createGlobalContextMock({ logger });
    const buildStep =
      createReadPackageJsonBuildFunction().createBuildStepFromFunctionCall(globalContext);
    jest.mocked(readAndLogPackageJson).mockImplementation(() => {
      throw new Error('failed to read package.json');
    });

    await expect(buildStep.executeAsync()).resolves.toBeUndefined();
    expect(stepLogger.error).toHaveBeenCalledWith({
      err: expect.any(Error),
    });
    expect(buildStep.outputById.package_json.value).toBeUndefined();
  });
});
