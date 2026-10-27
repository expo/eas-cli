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
    jest
      .mocked(readAppConfig)
      .mockResolvedValue({ exp: { name: 'my-app', slug: 'my-app-slug', version: '1.2.3' } } as any);

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
    expect(stepLogger.info).toHaveBeenCalledWith(
      JSON.stringify({ name: 'my-app', slug: 'my-app-slug', version: '1.2.3' }, null, 2)
    );
    const firstOutput = buildStep.outputById.app_config.value;
    expect(firstOutput).toBeDefined();
    expect(JSON.parse(firstOutput!)).toEqual({
      name: 'my-app',
      slug: 'my-app-slug',
      version: '1.2.3',
    });
  });

  it('does not throw if reading app config fails', async () => {
    const globalContext = createGlobalContextMock({ logger: createMockLogger() });
    const buildStep =
      createReadAppConfigBuildFunction().createBuildStepFromFunctionCall(globalContext);
    jest.mocked(readAppConfig).mockRejectedValue(new Error('failed to read app config'));

    await expect(buildStep.executeAsync()).resolves.toBeUndefined();
  });

  it('exports app fields as returned by app config', async () => {
    const globalContext = createGlobalContextMock({ logger: createMockLogger() });
    const buildStep =
      createReadAppConfigBuildFunction().createBuildStepFromFunctionCall(globalContext);
    jest
      .mocked(readAppConfig)
      .mockResolvedValue({ exp: { name: 'my-app', slug: 123, version: undefined } } as any);

    await buildStep.executeAsync();

    const secondOutput = buildStep.outputById.app_config.value;
    expect(secondOutput).toBeDefined();
    expect(JSON.parse(secondOutput!)).toEqual({
      name: 'my-app',
      slug: 123,
    });
  });
});
