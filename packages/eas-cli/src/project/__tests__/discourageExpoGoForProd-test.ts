import { Platform, Workflow } from '@expo/eas-build-job';
import getenv from 'getenv';
import resolveFrom from 'resolve-from';

import type { ProfileData } from '../../utils/profiles';
import { resolveVcsClient } from '../../vcs';
import { detectExpoGoProdBuildAsync } from '../discourageExpoGoForProdAsync';

jest.mock('getenv');
jest.mock('resolve-from');
jest.mock('../workflow', () => ({
  resolveWorkflowPerPlatformAsync: jest.fn(),
}));

const mockResolveWorkflowPerPlatformAsync = jest.mocked(
  require('../workflow').resolveWorkflowPerPlatformAsync
);

const projectDir = '/app';
const vcsClient = resolveVcsClient();

const createMockBuildProfile = (profileName: string): ProfileData<'build'> => ({
  profileName,
  platform: Platform.ANDROID,
  profile: {} as any,
});

describe(detectExpoGoProdBuildAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getenv.boolish).mockReturnValue(false);
    jest.mocked(resolveFrom).mockImplementation(() => {
      // expo-dev-client is not installed
      throw new Error('Module not found');
    });
  });

  describe('should return false', () => {
    it.each([
      ['non-production profiles', [createMockBuildProfile('development')]],
      ['undefined buildProfiles', undefined],
      ['empty buildProfiles', []],
    ])('should return false for %s', async (_, buildProfiles) => {
      const result = await detectExpoGoProdBuildAsync(buildProfiles, projectDir, vcsClient);

      expect(result).toBe(false);
      expect(mockResolveWorkflowPerPlatformAsync).not.toHaveBeenCalled();
    });

    it('when expo-dev-client is installed - that signals a development build', async () => {
      jest.mocked(resolveFrom).mockReturnValue('/path/to/expo-dev-client/package.json');
      const buildProfiles = [createMockBuildProfile('production')];

      const result = await detectExpoGoProdBuildAsync(buildProfiles, projectDir, vcsClient);

      expect(result).toBe(false);
      expect(mockResolveWorkflowPerPlatformAsync).not.toHaveBeenCalled();
    });

    it('when either platform is "generic" - likely a bare RN project', async () => {
      mockResolveWorkflowPerPlatformAsync.mockResolvedValue({
        android: Workflow.GENERIC,
        ios: Workflow.GENERIC,
      });
      const buildProfiles = [createMockBuildProfile('production')];

      const result = await detectExpoGoProdBuildAsync(buildProfiles, projectDir, vcsClient);

      expect(result).toBe(false);
    });
  });

  describe('should return true', () => {
    it('when production profile is used, there are no native directories (or are gitignored) AND expo-dev-client is not installed', async () => {
      mockResolveWorkflowPerPlatformAsync.mockResolvedValue({
        android: Workflow.MANAGED,
        ios: Workflow.MANAGED,
      });
      const buildProfiles = [createMockBuildProfile('production')];

      const result = await detectExpoGoProdBuildAsync(buildProfiles, projectDir, vcsClient);

      expect(result).toBe(true);
    });
  });
});
