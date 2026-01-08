import { vol } from 'memfs';

import { createGymfileForArchiveBuild, createGymfileForSimulatorBuild } from '../gymfile';
import { Credentials } from '../credentials/manager';
import { DistributionType } from '../credentials/provisioningProfile';

describe('gymfile', () => {
  beforeEach(() => {
    vol.reset();
    // Set up /tmp directory in the mock filesystem
    vol.fromJSON({
      '/tmp/.keep': '', // Create /tmp directory
    });
  });

  afterEach(() => {
    vol.reset();
  });

  describe('createGymfileForArchiveBuild', () => {
    it('should create Gymfile with all variables substituted correctly', async () => {
      const mockCredentials: Credentials = {
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
          'com.example.app.widget': {
            bundleIdentifier: 'com.example.app.widget',
            uuid: 'ffffffff-0000-1111-2222-333333333333',
            path: '/path/to/profile2.mobileprovision',
            target: 'com.example.app.widget',
            teamId: 'TEAM123',
            name: 'Widget Profile',
            developerCertificate: Buffer.from('cert'),
            certificateCommonName: 'iPhone Distribution',
            distributionType: DistributionType.APP_STORE,
          },
        },
      };

      const outputFile = '/tmp/Gymfile';

      await createGymfileForArchiveBuild({
        outputFile,
        credentials: mockCredentials,
        scheme: 'MyApp',
        buildConfiguration: 'Release',
        outputDirectory: '/tmp/output',
        clean: true,
        logsDirectory: '/tmp/logs',
      });

      const generatedContent = vol.readFileSync(outputFile, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should create Gymfile without build configuration when not provided', async () => {
      const mockCredentials: Credentials = {
        keychainPath: '/tmp/keychain',
        distributionType: DistributionType.AD_HOC,
        teamId: 'TEAM123',
        applicationTargetProvisioningProfile: {} as any,
        targetProvisioningProfiles: {
          'com.example.app': {
            bundleIdentifier: 'com.example.app',
            uuid: 'test-uuid',
            path: '/path/to/profile.mobileprovision',
            target: 'com.example.app',
            teamId: 'TEAM123',
            name: 'Profile',
            developerCertificate: Buffer.from('cert'),
            certificateCommonName: 'iPhone Distribution',
            distributionType: DistributionType.AD_HOC,
          },
        },
      };

      const outputFile = '/tmp/Gymfile';

      await createGymfileForArchiveBuild({
        outputFile,
        credentials: mockCredentials,
        scheme: 'TestScheme',
        outputDirectory: '/tmp/output',
        clean: false,
        logsDirectory: '/tmp/logs',
      });

      const generatedContent = vol.readFileSync(outputFile, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should include iCloud container environment when provided in entitlements', async () => {
      const mockCredentials: Credentials = {
        keychainPath: '/tmp/keychain',
        distributionType: DistributionType.APP_STORE,
        teamId: 'TEAM123',
        applicationTargetProvisioningProfile: {} as any,
        targetProvisioningProfiles: {
          'com.example.app': {
            bundleIdentifier: 'com.example.app',
            uuid: 'test-uuid',
            path: '/path/to/profile.mobileprovision',
            target: 'com.example.app',
            teamId: 'TEAM123',
            name: 'Profile',
            developerCertificate: Buffer.from('cert'),
            certificateCommonName: 'iPhone Distribution',
            distributionType: DistributionType.APP_STORE,
          },
        },
      };

      const outputFile = '/tmp/Gymfile';

      await createGymfileForArchiveBuild({
        outputFile,
        credentials: mockCredentials,
        scheme: 'MyApp',
        buildConfiguration: 'Release',
        outputDirectory: '/tmp/output',
        clean: true,
        logsDirectory: '/tmp/logs',
        entitlements: {
          'com.apple.developer.icloud-container-environment': 'Production',
        },
      });

      const generatedContent = vol.readFileSync(outputFile, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should handle multiple provisioning profiles correctly', async () => {
      const mockCredentials: Credentials = {
        keychainPath: '/tmp/keychain',
        distributionType: DistributionType.ENTERPRISE,
        teamId: 'TEAM123',
        applicationTargetProvisioningProfile: {} as any,
        targetProvisioningProfiles: {
          'com.example.app': {
            bundleIdentifier: 'com.example.app',
            uuid: 'main-app-uuid',
            path: '/path/to/main.mobileprovision',
            target: 'com.example.app',
            teamId: 'TEAM123',
            name: 'Main Profile',
            developerCertificate: Buffer.from('cert'),
            certificateCommonName: 'iPhone Distribution',
            distributionType: DistributionType.ENTERPRISE,
          },
          'com.example.app.widget': {
            bundleIdentifier: 'com.example.app.widget',
            uuid: 'widget-uuid',
            path: '/path/to/widget.mobileprovision',
            target: 'com.example.app.widget',
            teamId: 'TEAM123',
            name: 'Widget Profile',
            developerCertificate: Buffer.from('cert'),
            certificateCommonName: 'iPhone Distribution',
            distributionType: DistributionType.ENTERPRISE,
          },
          'com.example.app.extension': {
            bundleIdentifier: 'com.example.app.extension',
            uuid: 'extension-uuid',
            path: '/path/to/extension.mobileprovision',
            target: 'com.example.app.extension',
            teamId: 'TEAM123',
            name: 'Extension Profile',
            developerCertificate: Buffer.from('cert'),
            certificateCommonName: 'iPhone Distribution',
            distributionType: DistributionType.ENTERPRISE,
          },
        },
      };

      const outputFile = '/tmp/Gymfile';

      await createGymfileForArchiveBuild({
        outputFile,
        credentials: mockCredentials,
        scheme: 'MyApp',
        outputDirectory: '/tmp/output',
        clean: true,
        logsDirectory: '/tmp/logs',
      });

      const generatedContent = vol.readFileSync(outputFile, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });
  });

  describe('createGymfileForSimulatorBuild', () => {
    it('should create Gymfile with all simulator variables substituted correctly', async () => {
      const outputFile = '/tmp/Gymfile';

      await createGymfileForSimulatorBuild({
        outputFile,
        scheme: 'MyApp',
        buildConfiguration: 'Debug',
        derivedDataPath: '/tmp/derived-data',
        clean: true,
        logsDirectory: '/tmp/logs',
        simulatorDestination: 'generic/platform=iOS Simulator',
      });

      const generatedContent = vol.readFileSync(outputFile, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should create Gymfile without configuration when not provided', async () => {
      const outputFile = '/tmp/Gymfile';

      await createGymfileForSimulatorBuild({
        outputFile,
        scheme: 'TestApp',
        derivedDataPath: '/tmp/derived',
        clean: false,
        logsDirectory: '/tmp/logs',
        simulatorDestination: 'platform=iOS Simulator,name=iPhone 15',
      });

      const generatedContent = vol.readFileSync(outputFile, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should handle tvOS simulator destination', async () => {
      const outputFile = '/tmp/Gymfile';

      await createGymfileForSimulatorBuild({
        outputFile,
        scheme: 'MyTVApp',
        buildConfiguration: 'Debug',
        derivedDataPath: '/tmp/derived',
        clean: true,
        logsDirectory: '/tmp/logs',
        simulatorDestination: 'generic/platform=tvOS Simulator',
      });

      const generatedContent = vol.readFileSync(outputFile, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });
  });
});
