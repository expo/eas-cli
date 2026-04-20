import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import path from 'path';

import { Ios } from '@expo/eas-build-job';

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

// Minimal Credentials fixture for the archive branch — structure borrowed from
// packages/build-tools/src/ios/__tests__/gymfile.test.ts:22-51 so the Gymfile
// template interpolates without runtime errors.
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

// Helper: given a Gymfile string, extract the argument of `derived_data_path("...")`
// and resolve it relative to the cwd Fastlane will run from (workspacePath).
function readDerivedDataPathFromGymfile(gymfileContent: string, workspacePath: string): string {
  const match = gymfileContent.match(/derived_data_path\("([^"]+)"\)/);
  if (!match) {
    throw new Error(
      `Gymfile did not contain derived_data_path("..."). Content:\n${gymfileContent}`
    );
  }
  return path.resolve(workspacePath, match[1]);
}

// BuildContext.getReactNativeProjectDirectory() resolves to `${workingdir}/build/${projectRootDirectory}`
// (see packages/build-tools/src/context.ts:310,319). createTestIosJob sets
// projectRootDirectory: '.', so the project dir is `${WORKING_DIR}/build`, and the ios dir
// lives under `${WORKING_DIR}/build/ios`.
const PROJECT_DIR = path.join(WORKING_DIR, 'build');
const IOS_DIR = path.join(PROJECT_DIR, 'ios');

describe(runFastlaneGym, () => {
  beforeEach(() => {
    vol.reset();
    vol.fromJSON({ [path.join(IOS_DIR, '.keep')]: '' });
    (spawn as jest.Mock).mockClear();
  });

  it('returns paths that match the generated archive Gymfile template', async () => {
    const ctx = makeIosBuildContext({ simulator: false });

    const result = await runFastlaneGym(ctx, {
      scheme: 'App',
      buildConfiguration: 'Release',
      credentials: ARCHIVE_CREDENTIALS,
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

  it('returns paths that match the generated simulator Gymfile template', async () => {
    const ctx = makeIosBuildContext({ simulator: true });

    const result = await runFastlaneGym(ctx, {
      scheme: 'App',
      buildConfiguration: 'Debug',
      credentials: null,
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

    expect(result.derivedDataPath).toBe(path.join(IOS_DIR, 'build'));
    expect(result.workspacePath).toBe(IOS_DIR);
  });
});
