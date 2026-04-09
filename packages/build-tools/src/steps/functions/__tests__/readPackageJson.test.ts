import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { readPackageJson } from '../../../utils/project';
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
    jest.mocked(readPackageJson).mockReturnValue({ name: 'app', version: '1.0.0' });

    await buildStep.executeAsync();

    expect(readPackageJson).toHaveBeenCalledWith(globalContext.defaultWorkingDirectory);
    expect(stepLogger.info).toHaveBeenCalledWith('Using package.json:');
    expect(stepLogger.info).toHaveBeenCalledWith(
      JSON.stringify({ name: 'app', version: '1.0.0' }, null, 2)
    );
  });

  it('throws if reading package.json fails', async () => {
    const globalContext = createGlobalContextMock({ logger: createMockLogger() });
    const buildStep =
      createReadPackageJsonBuildFunction().createBuildStepFromFunctionCall(globalContext);
    jest.mocked(readPackageJson).mockImplementation(() => {
      throw new Error('failed to read package.json');
    });

    await expect(buildStep.executeAsync()).rejects.toThrow('failed to read package.json');
  });
});
