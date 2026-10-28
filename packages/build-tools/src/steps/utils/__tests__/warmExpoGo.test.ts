import { type bunyan } from '@expo/logger';

import { type CustomBuildContext } from '../../../customBuildContext';
import { downloadBuildAsync } from '../../functions/downloadBuild';
import { createExpoGoAppResolver } from '../warmExpoGo';

jest.mock('../../functions/downloadBuild', () => ({ downloadBuildAsync: jest.fn() }));

const ctx = { graphqlClient: {} } as CustomBuildContext;
const logger = { info: jest.fn() } as unknown as bunyan;
const expoGo = {
  application_archive_url: 'https://example.test/Expo-Go-58.0.7.tar.gz',
  version: '58.0.7',
};
const preinstalled = {
  bundleIdentifier: 'host.exp.Exponent',
  shortVersion: '58.0.7',
  version: '58.0.7',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(downloadBuildAsync).mockResolvedValue({ artifactPath: '/download/ExpoGo.app' });
});

it('uses the exact warm Expo Go without downloading and preserves launch inputs', async () => {
  const inputs = { expo_go: { value: expoGo }, launch_args: { value: ['-Fixture', '1'] } };
  const resolve = createExpoGoAppResolver({ ctx, inputs, logger });
  expect(await resolve(preinstalled)).toEqual({
    ...inputs,
    expo_go: { value: undefined },
    install_app_path: { value: undefined },
    launch_app_identifier: { value: 'host.exp.Exponent' },
  });
  expect(downloadBuildAsync).not.toHaveBeenCalled();
});

it.each([
  undefined,
  { ...preinstalled, bundleIdentifier: 'other.app' },
  { ...preinstalled, shortVersion: '58.0.5' },
  { ...preinstalled, version: 'different-build' },
])('downloads the requested artifact on a preinstall miss: %j', async installed => {
  const inputs = { expo_go: { value: expoGo } };
  const resolve = createExpoGoAppResolver({ ctx, inputs, logger });
  expect(await resolve(installed)).toMatchObject({
    install_app_path: { value: '/download/ExpoGo.app' },
  });
  expect(downloadBuildAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      applicationArchiveUrl: expoGo.application_archive_url,
      extensions: ['app'],
    })
  );
});

it('downloads on cold fallback after a match, and reuses that download on another retry', async () => {
  const resolve = createExpoGoAppResolver({ ctx, inputs: { expo_go: { value: expoGo } }, logger });
  await resolve(preinstalled);
  expect(downloadBuildAsync).not.toHaveBeenCalled();
  await resolve();
  await resolve();
  expect(downloadBuildAsync).toHaveBeenCalledTimes(1);
});

it('leaves existing local-app jobs unchanged', async () => {
  const inputs = { install_app_path: { value: '/existing.app' } };
  expect(await createExpoGoAppResolver({ ctx, inputs, logger })()).toBe(inputs);
  expect(downloadBuildAsync).not.toHaveBeenCalled();
});

it('refuses conflicting application inputs before download', async () => {
  const inputs = { expo_go: { value: expoGo }, install_app_path: { value: '/other.app' } };
  await expect(createExpoGoAppResolver({ ctx, inputs, logger })(preinstalled)).rejects.toThrow(
    'Pass expo_go or install_app_path/launch_app_identifier, not both.'
  );
  expect(downloadBuildAsync).not.toHaveBeenCalled();
});

it('does not download or reuse an app after cancellation', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await expect(
    createExpoGoAppResolver({
      ctx,
      inputs: { expo_go: { value: expoGo } },
      logger,
      signal: controller.signal,
    })(preinstalled)
  ).rejects.toThrow('cancelled');
  expect(downloadBuildAsync).not.toHaveBeenCalled();
});

it('rejects non-HTTP sources even when the installed version matches', async () => {
  await expect(
    createExpoGoAppResolver({
      ctx,
      inputs: { expo_go: { value: { ...expoGo, application_archive_url: 'file:///other.app' } } },
      logger,
    })(preinstalled)
  ).rejects.toThrow();
  expect(downloadBuildAsync).not.toHaveBeenCalled();
});

it('does not launch a completed download after cancellation', async () => {
  const controller = new AbortController();
  jest.mocked(downloadBuildAsync).mockImplementationOnce(async () => {
    controller.abort(new Error('cancelled during download'));
    return { artifactPath: '/download/ExpoGo.app' };
  });
  await expect(
    createExpoGoAppResolver({
      ctx,
      inputs: { expo_go: { value: expoGo } },
      logger,
      signal: controller.signal,
    })()
  ).rejects.toThrow('cancelled during download');
  expect(downloadBuildAsync).toHaveBeenCalledWith(
    expect.objectContaining({ signal: controller.signal })
  );
});
