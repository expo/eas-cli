import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { readAppConfig } from '../../../utils/appConfig';
import { createReadAppConfigBuildFunction } from '../readAppConfig';

jest.mock('../../../utils/appConfig');

describe(createReadAppConfigBuildFunction, () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('reads and logs app configuration', async () => {
    const stepLogger = createMockLogger();
    const logger = createMockLogger();
    logger.child = jest.fn().mockReturnValue(stepLogger);
    const globalContext = createGlobalContextMock({
      logger,
      staticContextContent: { metadata: { sdkVersion: '54.0.0' } },
    });
    globalContext.updateEnv({ EXPO_PUBLIC_TEST: '1' });
    const buildStep =
      createReadAppConfigBuildFunction().createBuildStepFromFunctionCall(globalContext);
    jest.mocked(readAppConfig).mockResolvedValue({ exp: { name: 'my-app' } } as any);

    await buildStep.executeAsync();

    expect(readAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDir: globalContext.defaultWorkingDirectory,
        env: expect.objectContaining({ EXPO_PUBLIC_TEST: '1' }),
        logger: stepLogger,
        sdkVersion: '54.0.0',
      })
    );
    expect(stepLogger.info).toHaveBeenCalledWith('Using app configuration:');
    expect(stepLogger.info).toHaveBeenCalledWith(JSON.stringify({ name: 'my-app' }, null, 2));
  });

  it('throws if reading app config fails', async () => {
    const globalContext = createGlobalContextMock({ logger: createMockLogger() });
    const buildStep =
      createReadAppConfigBuildFunction().createBuildStepFromFunctionCall(globalContext);
    jest.mocked(readAppConfig).mockRejectedValue(new Error('failed to read app config'));

    await expect(buildStep.executeAsync()).rejects.toThrow('failed to read app config');
  });
});
