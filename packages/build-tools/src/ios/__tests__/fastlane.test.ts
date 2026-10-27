import { Ios } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import path from 'path';

import { createTestIosJob } from '../../__tests__/utils/job';
import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { Credentials } from '../credentials/manager';
import { DistributionType } from '../credentials/provisioningProfile';
import { runFastlaneGym } from '../fastlane';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../tvos', () => ({
  isTVOS: jest.fn().mockResolvedValue(false),
}));

const WORKING_DIR = '/workingdir';
// BuildContext.getReactNativeProjectDirectory() nests the RN project under `${workingdir}/build`.
const IOS_DIR = path.join(WORKING_DIR, 'build', 'ios');

function makeIosBuildContext({ simulator }: { simulator: boolean }): BuildContext<Ios.Job> {
  const job: Ios.Job = { ...createTestIosJob(), simulator };
  return new BuildContext(job, {
    workingdir: WORKING_DIR,
    logger: createMockLogger(),
    logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
    env: { __API_SERVER_URL: 'http://api.expo.test' },
    uploadArtifact: jest.fn(),
  });
}

const ARCHIVE_CREDENTIALS: Credentials = {
  keychainPath: '/Users/expo/Library/Keychains/login.keychain',
  distributionType: DistributionType.APP_STORE,
  teamId: 'TEAM123',
  applicationTargetProvisioningProfile: {} as any,
  targetProvisioningProfiles: {
    'com.example.app': {
      bundleIdentifier: 'com.example.app',
      uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      path: '/path/to/profile1.mobileprovision',
      target: 'com.example.app',
      teamId: 'TEAM123',
      name: 'Main App Profile',
      developerCertificate: Buffer.from('cert'),
      certificateCommonName: 'iPhone Distribution',
      distributionType: DistributionType.APP_STORE,
    },
  },
};

function readDerivedDataPathFromGymfile(gymfileContent: string, workspacePath: string): string {
  const match = gymfileContent.match(/derived_data_path\("([^"]+)"\)/);
  if (!match) {
    throw new Error(
      `Gymfile did not contain derived_data_path("..."). Content:\n${gymfileContent}`
    );
  }
  return path.resolve(workspacePath, match[1]);
}

describe(runFastlaneGym, () => {
  beforeEach(() => {
    vol.reset();
    vol.fromJSON({ [path.join(IOS_DIR, '.keep')]: '' });
    (spawn as jest.Mock).mockClear();
  });

  describe.each([
    {
      name: 'archive',
      simulator: false,
      credentials: ARCHIVE_CREDENTIALS,
      buildConfiguration: 'Release',
    },
    {
      name: 'simulator',
      simulator: true,
      credentials: null,
      buildConfiguration: 'Debug',
    },
  ])('$name build', ({ simulator, credentials, buildConfiguration }) => {
    it('returns paths that match the generated Gymfile template', async () => {
      const ctx = makeIosBuildContext({ simulator });

      const result = await runFastlaneGym(ctx, {
        scheme: 'App',
        buildConfiguration,
        credentials,
        entitlements: null,
      });

      expect(result).toEqual({
        derivedDataPath: path.join(IOS_DIR, 'build'),
        workspacePath: IOS_DIR,
      });

      const gymfileContent = vol.readFileSync(path.join(IOS_DIR, 'Gymfile'), 'utf8') as string;
      expect(readDerivedDataPathFromGymfile(gymfileContent, result.workspacePath)).toBe(
        result.derivedDataPath
      );
    });
  });

  it('still returns EAS-convention paths when a pre-existing ios/Gymfile is present', async () => {
    vol.fromJSON({
      [path.join(IOS_DIR, 'Gymfile')]: '# user-supplied Gymfile\n',
    });

    const ctx = makeIosBuildContext({ simulator: false });

    const result = await runFastlaneGym(ctx, {
      scheme: 'App',
      credentials: ARCHIVE_CREDENTIALS,
      entitlements: null,
    });

    expect(result).toEqual({
      derivedDataPath: path.join(IOS_DIR, 'build'),
      workspacePath: IOS_DIR,
    });
  });
});
