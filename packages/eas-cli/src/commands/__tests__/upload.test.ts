import { Platform } from '@expo/eas-build-job';
import { vol } from 'memfs';
import StreamZip from 'node-stream-zip';

import { getMockOclifConfig } from '../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../credentials/__tests__/fixtures-constants';
import { LocalBuildMutation } from '../../graphql/mutations/LocalBuildMutation';
import { uploadFileAtPathToGCSAsync } from '../../uploads';
import BuildUpload from '../upload';

jest.mock('fs');
jest.mock('fs/promises');
jest.mock('../../log');
jest.mock('../../uploads');
jest.mock('../../graphql/mutations/LocalBuildMutation');
jest.mock('../../graphql/mutations/FingerprintMutation');
jest.mock('node-stream-zip');

const BUILD_PATH = '/app/android/app/build/outputs/apk/debug/app-debug.apk';

describe(BuildUpload, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  function createCommand(argv: string[]): BuildUpload {
    const command = new BuildUpload(
      [...argv, '--platform=android', '--non-interactive'],
      mockConfig
    );
    jest.spyOn(command as any, 'getContextAsync').mockResolvedValue({
      projectId: testProjectId,
      loggedIn: { graphqlClient },
    } as never);
    return command;
  }

  function recordedDevelopmentClient(): boolean {
    const calls = jest.mocked(LocalBuildMutation.createLocalBuildAsync).mock.calls;
    expect(calls).toHaveLength(1);
    return (calls[0][4] as { developmentClient: boolean }).developmentClient;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    vol.reset();
    vol.fromJSON({ [BUILD_PATH]: 'not-a-real-apk' });

    // An APK carrying no dev menu marker: what the probe sees for an Android
    // build produced by `expo run:android`.
    jest.mocked(StreamZip.async).mockImplementation(
      () =>
        ({
          entry: jest.fn().mockResolvedValue(null),
          entryData: jest.fn(),
          entries: jest.fn().mockResolvedValue({}),
          close: jest.fn().mockResolvedValue(undefined),
        }) as never
    );
    jest.mocked(uploadFileAtPathToGCSAsync).mockResolvedValue('bucket-key');
    jest.mocked(LocalBuildMutation.createLocalBuildAsync).mockResolvedValue({
      id: 'build-id',
      platform: Platform.ANDROID,
      app: { slug: 'testapp', ownerAccount: { name: 'testuser' } },
    } as never);
  });

  it('falls back to what the archive shows when neither flag is passed', async () => {
    await createCommand([`--build-path=${BUILD_PATH}`]).runAsync();

    expect(recordedDevelopmentClient()).toBe(false);
  });

  it('records a development client when --dev-client is passed', async () => {
    await createCommand([`--build-path=${BUILD_PATH}`, '--dev-client']).runAsync();

    // The archive probe alone files this build as a plain one, and
    // `build:download --dev-client` then never finds it again.
    expect(recordedDevelopmentClient()).toBe(true);
  });

  it('records a plain build when --no-dev-client is passed', async () => {
    await createCommand([`--build-path=${BUILD_PATH}`, '--no-dev-client']).runAsync();

    expect(recordedDevelopmentClient()).toBe(false);
  });
});
