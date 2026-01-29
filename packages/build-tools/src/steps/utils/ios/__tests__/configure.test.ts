import path from 'path';

import { vol } from 'memfs';

import { configureCredentialsAsync, updateVersionsAsync } from '../configure';
import ProvisioningProfile, { DistributionType } from '../credentials/provisioningProfile';

jest.mock('fs');
const originalFs = jest.requireActual('fs');

afterEach(() => {
  vol.reset();
});

describe(configureCredentialsAsync, () => {
  it('configures credentials for a simple project', async () => {
    vol.fromJSON(
      {
        'ios/testapp.xcodeproj/project.pbxproj': originalFs.readFileSync(
          path.join(__dirname, 'fixtures/simple-project.pbxproj'),
          'utf-8'
        ),
        'ios/testapp/AppDelegate.m': 'placeholder',
      },
      '/app'
    );
    const options = {
      credentials: {
        keychainPath: 'fake/path',
        targetProvisioningProfiles: {
          testapp: {
            path: 'fake/path.mobileprovision',
            target: 'testapp',
            bundleIdentifier: 'abc',
            teamId: 'ABCDEFGH',
            uuid: 'abc',
            name: 'profile name',
            developerCertificate: Buffer.from('test'),
            certificateCommonName: 'Abc 123',
            distributionType: DistributionType.APP_STORE,
          },
        },
        distributionType: DistributionType.APP_STORE,
        teamId: 'ABCDEFGH',
        applicationTargetProvisioningProfile: {} as ProvisioningProfile,
      },
      buildConfiguration: 'Release',
    };
    await configureCredentialsAsync({ info: jest.fn() } as any, '/app', options);
    expect(
      vol.readFileSync('/app/ios/testapp.xcodeproj/project.pbxproj', 'utf-8')
    ).toMatchSnapshot();
  });
  it('configures credentials for multi target project', async () => {
    vol.fromJSON(
      {
        'ios/testapp.xcodeproj/project.pbxproj': originalFs.readFileSync(
          path.join(__dirname, 'fixtures/multitarget-project.pbxproj'),
          'utf-8'
        ),
        'ios/testapp/AppDelegate.m': 'placeholder',
      },
      '/app'
    );
    const options = {
      credentials: {
        keychainPath: 'fake/path',
        targetProvisioningProfiles: {
          shareextension: {
            path: 'fake/path1.mobileprovision',
            target: 'shareextension',
            bundleIdentifier: 'abc.extension',
            teamId: 'ABCDEFGH',
            uuid: 'abc',
            name: 'extension profile',
            developerCertificate: Buffer.from('test'),
            certificateCommonName: 'Abc 123',
            distributionType: DistributionType.APP_STORE,
          },
          multitarget: {
            path: 'fake/path2.mobileprovision',
            target: 'multitarget',
            bundleIdentifier: 'abc',
            teamId: 'ABCDEFGH',
            uuid: 'abc',
            name: 'multitarget profile',
            developerCertificate: Buffer.from('test'),
            certificateCommonName: 'Abc 123',
            distributionType: DistributionType.APP_STORE,
          },
        },
        distributionType: DistributionType.APP_STORE,
        teamId: 'ABCDEFGH',
        applicationTargetProvisioningProfile: {} as ProvisioningProfile,
      },
      buildConfiguration: 'Release',
    };
    await configureCredentialsAsync({ info: jest.fn() } as any, '/app', options);
    expect(
      vol.readFileSync('/app/ios/testapp.xcodeproj/project.pbxproj', 'utf-8')
    ).toMatchSnapshot();
  });
});

describe(updateVersionsAsync, () => {
  it('configures versions for a simple project', async () => {
    vol.fromJSON(
      {
        'ios/testapp/Info.plist': originalFs.readFileSync(
          path.join(__dirname, 'fixtures/Info.plist'),
          'utf-8'
        ),
        'ios/testapp.xcodeproj/project.pbxproj': originalFs.readFileSync(
          path.join(__dirname, 'fixtures/simple-project.pbxproj'),
          'utf-8'
        ),
        'ios/testapp/AppDelegate.m': 'placeholder',
      },
      '/app'
    );
    const options = {
      credentials: {
        keychainPath: 'fake/path',
        targetProvisioningProfiles: {
          testapp: {
            path: 'fake/path.mobileprovision',
            target: 'testapp',
            bundleIdentifier: 'abc',
            teamId: 'ABCDEFGH',
            uuid: 'abc',
            name: 'profile name',
            developerCertificate: Buffer.from('test'),
            certificateCommonName: 'Abc 123',
            distributionType: DistributionType.APP_STORE,
          },
        },
        distributionType: DistributionType.APP_STORE,
        teamId: 'ABCDEFGH',
        applicationTargetProvisioningProfile: {} as ProvisioningProfile,
      },
      buildConfiguration: 'Release',
    };

    await configureCredentialsAsync({ info: jest.fn() } as any, '/app', options);
    await updateVersionsAsync(
      { info: jest.fn() } as any,
      '/app',
      { appVersion: '1.2.3', buildNumber: '1.2.4' },
      { ...options, targetNames: Object.keys(options.credentials.targetProvisioningProfiles) }
    );
    expect(
      vol.readFileSync('/app/ios/testapp.xcodeproj/project.pbxproj', 'utf-8')
    ).toMatchSnapshot();
    expect(vol.readFileSync('/app/ios/testapp/Info.plist', 'utf-8')).toMatchSnapshot(
      'Info.plist application target'
    );
  });
  it('configures credentials and versions for multi target project', async () => {
    vol.fromJSON(
      {
        'ios/multitarget/Info.plist': originalFs.readFileSync(
          path.join(__dirname, 'fixtures/Info.plist'),
          'utf-8'
        ),
        'ios/shareextension/Info.plist': originalFs.readFileSync(
          path.join(__dirname, 'fixtures/Info.plist'),
          'utf-8'
        ),
        'ios/testapp.xcodeproj/project.pbxproj': originalFs.readFileSync(
          path.join(__dirname, 'fixtures/multitarget-project.pbxproj'),
          'utf-8'
        ),
        'ios/testapp/AppDelegate.m': 'placeholder',
      },
      '/app'
    );
    const options = {
      credentials: {
        keychainPath: 'fake/path',
        targetProvisioningProfiles: {
          shareextension: {
            path: 'fake/path1.mobileprovision',
            target: 'shareextension',
            bundleIdentifier: 'abc.extension',
            teamId: 'ABCDEFGH',
            uuid: 'abc',
            name: 'extension profile',
            developerCertificate: Buffer.from('test'),
            certificateCommonName: 'Abc 123',
            distributionType: DistributionType.APP_STORE,
          },
          multitarget: {
            path: 'fake/path2.mobileprovision',
            target: 'multitarget',
            bundleIdentifier: 'abc',
            teamId: 'ABCDEFGH',
            uuid: 'abc',
            name: 'multitarget profile',
            developerCertificate: Buffer.from('test'),
            certificateCommonName: 'Abc 123',
            distributionType: DistributionType.APP_STORE,
          },
        },
        distributionType: DistributionType.APP_STORE,
        teamId: 'ABCDEFGH',
        applicationTargetProvisioningProfile: {} as ProvisioningProfile,
      },
      buildConfiguration: 'Release',
    };

    await configureCredentialsAsync({ info: jest.fn() } as any, '/app', options);
    await updateVersionsAsync(
      { info: jest.fn() } as any,
      '/app',
      { appVersion: '1.2.3', buildNumber: '1.2.4' },
      { ...options, targetNames: Object.keys(options.credentials.targetProvisioningProfiles) }
    );
    expect(
      vol.readFileSync('/app/ios/testapp.xcodeproj/project.pbxproj', 'utf-8')
    ).toMatchSnapshot();
    expect(vol.readFileSync('/app/ios/shareextension/Info.plist', 'utf-8')).toMatchSnapshot(
      'Info.plist application target'
    );
    expect(vol.readFileSync('/app/ios/multitarget/Info.plist', 'utf-8')).toMatchSnapshot(
      'Info.plist extension'
    );
  });
});
