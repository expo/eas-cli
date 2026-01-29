import { vol } from 'memfs';

import { createFastfileForResigningBuild } from '../fastfile';
import { TargetProvisioningProfiles } from '../credentials/manager';

describe('fastfile', () => {
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

  describe('createFastfileForResigningBuild', () => {
    it('should create Fastfile with all variables substituted correctly', async () => {
      const mockTargetProvisioningProfiles: TargetProvisioningProfiles = {
        'com.example.app': {
          bundleIdentifier: 'com.example.app',
          uuid: 'test-uuid-1',
          path: '/path/to/profiles/main.mobileprovision',
        } as any,
        'com.example.app.widget': {
          bundleIdentifier: 'com.example.app.widget',
          uuid: 'test-uuid-2',
          path: '/path/to/profiles/widget.mobileprovision',
        } as any,
      };

      const outputFile = '/tmp/Fastfile';

      await createFastfileForResigningBuild({
        outputFile,
        ipaPath: '/builds/MyApp.ipa',
        signingIdentity: 'iPhone Distribution: Example Inc (ABC123)',
        keychainPath: '/Users/expo/Library/Keychains/login.keychain',
        targetProvisioningProfiles: mockTargetProvisioningProfiles,
      });

      const generatedContent = vol.readFileSync(outputFile, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should handle single provisioning profile', async () => {
      const mockTargetProvisioningProfiles: TargetProvisioningProfiles = {
        'com.example.app': {
          bundleIdentifier: 'com.example.app',
          uuid: 'single-uuid',
          path: '/tmp/profile.mobileprovision',
        } as any,
      };

      const outputFile = '/tmp/Fastfile';

      await createFastfileForResigningBuild({
        outputFile,
        ipaPath: '/tmp/app.ipa',
        signingIdentity: 'iPhone Distribution',
        keychainPath: '/tmp/keychain',
        targetProvisioningProfiles: mockTargetProvisioningProfiles,
      });

      const generatedContent = vol.readFileSync(outputFile, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should handle multiple provisioning profiles correctly', async () => {
      const mockTargetProvisioningProfiles: TargetProvisioningProfiles = {
        'com.example.app': {
          bundleIdentifier: 'com.example.app',
          uuid: 'uuid-main',
          path: '/profiles/main.mobileprovision',
        } as any,
        'com.example.app.widget': {
          bundleIdentifier: 'com.example.app.widget',
          uuid: 'uuid-widget',
          path: '/profiles/widget.mobileprovision',
        } as any,
        'com.example.app.extension': {
          bundleIdentifier: 'com.example.app.extension',
          uuid: 'uuid-extension',
          path: '/profiles/extension.mobileprovision',
        } as any,
        'com.example.app.intents': {
          bundleIdentifier: 'com.example.app.intents',
          uuid: 'uuid-intents',
          path: '/profiles/intents.mobileprovision',
        } as any,
      };

      const outputFile = '/tmp/Fastfile';

      await createFastfileForResigningBuild({
        outputFile,
        ipaPath: '/tmp/app.ipa',
        signingIdentity: 'iPhone Distribution: Company Name',
        keychainPath: '/tmp/keychain',
        targetProvisioningProfiles: mockTargetProvisioningProfiles,
      });

      const generatedContent = vol.readFileSync(outputFile, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should handle empty provisioning profiles', async () => {
      const mockTargetProvisioningProfiles: TargetProvisioningProfiles = {};

      const outputFile = '/tmp/Fastfile';

      await createFastfileForResigningBuild({
        outputFile,
        ipaPath: '/tmp/app.ipa',
        signingIdentity: 'iPhone Distribution',
        keychainPath: '/tmp/keychain',
        targetProvisioningProfiles: mockTargetProvisioningProfiles,
      });

      const generatedContent = vol.readFileSync(outputFile, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should handle paths with special characters and spaces', async () => {
      const mockTargetProvisioningProfiles: TargetProvisioningProfiles = {
        'com.example.app': {
          bundleIdentifier: 'com.example.app',
          uuid: 'test-uuid',
          path: '/path/with spaces/profile (1).mobileprovision',
        } as any,
      };

      const outputFile = '/tmp/Fastfile';

      await createFastfileForResigningBuild({
        outputFile,
        ipaPath: '/builds/My App (Release).ipa',
        signingIdentity: 'iPhone Distribution: Example Inc (ABC123XYZ)',
        keychainPath: '/Users/expo/Library/Keychains/login keychain.keychain',
        targetProvisioningProfiles: mockTargetProvisioningProfiles,
      });

      const generatedContent = vol.readFileSync(outputFile, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should produce valid Ruby syntax', async () => {
      const mockTargetProvisioningProfiles: TargetProvisioningProfiles = {
        'com.example.app': {
          bundleIdentifier: 'com.example.app',
          uuid: 'test-uuid',
          path: '/path/to/profile.mobileprovision',
        } as any,
      };

      const outputFile = '/tmp/Fastfile';

      await createFastfileForResigningBuild({
        outputFile,
        ipaPath: '/tmp/app.ipa',
        signingIdentity: 'iPhone Distribution',
        keychainPath: '/tmp/keychain',
        targetProvisioningProfiles: mockTargetProvisioningProfiles,
      });

      const generatedContent = vol.readFileSync(outputFile, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });
  });
});
