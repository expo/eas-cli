import { Platform } from '@expo/eas-build-job';
import { vol } from 'memfs';
import { instance, mock } from 'ts-mockito';
import { v4 as uuidv4 } from 'uuid';

import { Analytics } from '../../../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  jester as mockJester,
  testProjectId,
} from '../../../credentials/__tests__/fixtures-constants';
import { BuildFragment, SubmissionArchiveSourceType } from '../../../graphql/generated';
import { SubmissionMutation } from '../../../graphql/mutations/SubmissionMutation';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { resolveVcsClient } from '../../../vcs';
import {
  ArchiveResolverContext,
  ArchiveSource,
  ArchiveSourceType,
  getArchiveAsync,
} from '../../ArchiveSource';
import { refreshContextSubmitProfileAsync } from '../../commons';
import { SubmissionContext, createSubmissionContextAsync } from '../../context';
import IosSubmitCommand from '../IosSubmitCommand';

jest.mock('fs');
jest.mock('../../../ora');
jest.mock('../../../graphql/mutations/SubmissionMutation', () => ({
  SubmissionMutation: {
    createIosSubmissionAsync: jest.fn(),
  },
}));
jest.mock('../../../user/User', () => ({
  getUserAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../user/actions', () => ({
  ensureLoggedInAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../project/projectUtils');
jest.mock('../../ArchiveSource', () => {
  return {
    __esModule__: true,
    ...jest.requireActual('../../ArchiveSource'),
    getArchiveAsync: jest.fn(),
  };
});
jest.mock('../../commons', () => {
  return {
    __esModule__: true,
    ...jest.requireActual('../../commons'),
    refreshContextSubmitProfileAsync: jest.fn(),
  };
});

const vcsClient = resolveVcsClient();

describe(IosSubmitCommand, () => {
  const testProject = createTestProject(testProjectId, mockJester.accounts[0].name, {});

  const fakeFiles: Record<string, string> = {
    '/artifacts/fake.ipa': 'fake ipa',
  };

  beforeAll(() => {
    vol.fromJSON({
      ...testProject.projectTree,
      ...fakeFiles,
    });
  });
  afterAll(() => {
    vol.reset();
    jest.unmock('@expo/config');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue(mockJester.accounts[0]);
  });

  it('throws an error if using app specific password in invalid format', async () => {
    const projectId = uuidv4();
    const graphqlClient = {} as any as ExpoGraphqlClient;
    const analytics = instance(mock<Analytics>());
    jest
      .mocked(getArchiveAsync)
      .mockImplementation(jest.requireActual('../../ArchiveSource').getArchiveAsync);

    process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD = 'ls -la';

    const ctx = await createSubmissionContextAsync({
      platform: Platform.IOS,
      projectDir: testProject.projectRoot,
      archiveFlags: {
        url: 'http://expo.dev/fake.ipa',
      },
      profile: {
        language: 'en-US',
        appleId: 'test@example.com',
        ascAppId: '12345678',
      },
      nonInteractive: false,
      isVerboseFastlaneEnabled: false,
      actor: mockJester,
      graphqlClient,
      analytics,
      exp: testProject.appJSON.expo,
      projectId,
      vcsClient,
    });
    const command = new IosSubmitCommand(ctx);
    await expect(command.runAsync().then(submitter => submitter.submitAsync())).rejects.toThrow(
      'EXPO_APPLE_APP_SPECIFIC_PASSWORD must be in the format xxxx-xxxx-xxxx-xxxx, where x is a lowercase letter.'
    );

    delete process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD;
  });

  describe('non-interactive mode', () => {
    it("throws error if didn't provide appleId and ascAppId in the submit profile", async () => {
      const projectId = uuidv4();
      const graphqlClient = {} as any as ExpoGraphqlClient;
      const analytics = instance(mock<Analytics>());
      jest
        .mocked(getArchiveAsync)
        .mockImplementation(jest.requireActual('../../ArchiveSource').getArchiveAsync);

      const ctx = await createSubmissionContextAsync({
        platform: Platform.IOS,
        projectDir: testProject.projectRoot,
        archiveFlags: {
          url: 'http://expo.dev/fake.ipa',
        },
        profile: {
          language: 'en-US',
        },
        nonInteractive: true,
        isVerboseFastlaneEnabled: false,
        actor: mockJester,
        graphqlClient,
        analytics,
        exp: testProject.appJSON.expo,
        projectId,
        vcsClient,
      });
      const command = new IosSubmitCommand(ctx);
      await expect(
        command.runAsync().then(submitter => submitter.submitAsync())
      ).rejects.toThrowError();
    });
  });

  describe('sending submission', () => {
    it('sends a request to EAS Submit', async () => {
      const projectId = uuidv4();
      const graphqlClient = {} as any as ExpoGraphqlClient;
      const analytics = instance(mock<Analytics>());
      jest
        .mocked(getArchiveAsync)
        .mockImplementation(jest.requireActual('../../ArchiveSource').getArchiveAsync);

      process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD = 'abcd-abcd-abcd-abcd';

      const ctx = await createSubmissionContextAsync({
        platform: Platform.IOS,
        projectDir: testProject.projectRoot,
        archiveFlags: {
          url: 'http://expo.dev/fake.ipa',
        },
        profile: {
          language: 'en-US',
          appleId: 'test@example.com',
          ascAppId: '12345678',
        },
        nonInteractive: false,
        isVerboseFastlaneEnabled: false,
        actor: mockJester,
        graphqlClient,
        analytics,
        exp: testProject.appJSON.expo,
        projectId,
        vcsClient,
      });
      const command = new IosSubmitCommand(ctx);
      const submitter = await command.runAsync();
      await submitter.submitAsync();

      expect(SubmissionMutation.createIosSubmissionAsync).toHaveBeenCalledWith(graphqlClient, {
        appId: projectId,
        archiveSource: { type: SubmissionArchiveSourceType.Url, url: 'http://expo.dev/fake.ipa' },
        config: {
          appleIdUsername: 'test@example.com',
          appleAppSpecificPassword: 'abcd-abcd-abcd-abcd',
          ascAppIdentifier: '12345678',
          isVerboseFastlaneEnabled: false,
        },
        submittedBuildId: undefined,
      });

      delete process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD;
    });
    describe('build selected from EAS', () => {
      it('sends a request to EAS Submit with profile data matching selected build profile', async () => {
        const projectId = uuidv4();
        const graphqlClient = {} as any as ExpoGraphqlClient;
        const analytics = instance(mock<Analytics>());
        const selectedBuild = {
          id: uuidv4(),
          buildProfile: 'otherProfile',
        } as any as BuildFragment;
        jest
          .mocked(getArchiveAsync)
          .mockImplementation(async (_ctx: ArchiveResolverContext, _source: ArchiveSource) => {
            return {
              sourceType: ArchiveSourceType.build,
              build: selectedBuild,
            };
          });
        jest
          .mocked(refreshContextSubmitProfileAsync)
          .mockImplementation(async (ctx: SubmissionContext<Platform>, _archiveProfile: string) => {
            ctx.profile = {
              language: 'en-US',
              appleId: 'other-test@example.com',
              ascAppId: '87654321',
            };
            return ctx;
          });

        process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD = 'abcd-abcd-abcd-abcd';

        const ctx = await createSubmissionContextAsync({
          platform: Platform.IOS,
          projectDir: testProject.projectRoot,
          archiveFlags: {},
          profile: {
            language: 'en-US',
            appleId: 'test@example.com',
            ascAppId: '12345678',
          },
          nonInteractive: false,
          isVerboseFastlaneEnabled: false,
          actor: mockJester,
          graphqlClient,
          analytics,
          exp: testProject.appJSON.expo,
          projectId,
          vcsClient,
        });
        const command = new IosSubmitCommand(ctx);
        const submitter = await command.runAsync();
        await submitter.submitAsync();

        expect(SubmissionMutation.createIosSubmissionAsync).toHaveBeenCalledWith(graphqlClient, {
          appId: projectId,
          submittedBuildId: selectedBuild.id,
          config: {
            appleIdUsername: 'other-test@example.com',
            appleAppSpecificPassword: 'abcd-abcd-abcd-abcd',
            ascAppIdentifier: '87654321',
            isVerboseFastlaneEnabled: false,
          },
          archiveSource: undefined,
        });

        delete process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD;
      });
      it('sends a request to EAS Submit with default profile data when submit profile matching selected build profile does not exist', async () => {
        const projectId = uuidv4();
        const graphqlClient = {} as any as ExpoGraphqlClient;
        const analytics = instance(mock<Analytics>());
        const selectedBuild = {
          id: uuidv4(),
          buildProfile: 'otherProfile',
        } as any as BuildFragment;
        jest
          .mocked(getArchiveAsync)
          .mockImplementation(async (_ctx: ArchiveResolverContext, _source: ArchiveSource) => {
            return {
              sourceType: ArchiveSourceType.build,
              build: selectedBuild,
            };
          });
        jest
          .mocked(refreshContextSubmitProfileAsync)
          .mockImplementation(async (ctx: SubmissionContext<Platform>, _archiveProfile: string) => {
            return ctx;
          });

        process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD = 'abcd-abcd-abcd-abcd';

        const ctx = await createSubmissionContextAsync({
          platform: Platform.IOS,
          projectDir: testProject.projectRoot,
          archiveFlags: {},
          profile: {
            language: 'en-US',
            appleId: 'test@example.com',
            ascAppId: '12345678',
          },
          nonInteractive: false,
          isVerboseFastlaneEnabled: false,
          actor: mockJester,
          graphqlClient,
          analytics,
          exp: testProject.appJSON.expo,
          projectId,
          vcsClient,
        });
        const command = new IosSubmitCommand(ctx);
        const submitter = await command.runAsync();
        await submitter.submitAsync();

        expect(SubmissionMutation.createIosSubmissionAsync).toHaveBeenCalledWith(graphqlClient, {
          appId: projectId,
          submittedBuildId: selectedBuild.id,
          config: {
            appleIdUsername: 'test@example.com',
            appleAppSpecificPassword: 'abcd-abcd-abcd-abcd',
            ascAppIdentifier: '12345678',
            isVerboseFastlaneEnabled: false,
          },
          archiveSource: undefined,
        });

        delete process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD;
      });
      it('sends a request to EAS Submit with specified profile data even when submit profile matching selected build profile exists', async () => {
        const projectId = uuidv4();
        const graphqlClient = {} as any as ExpoGraphqlClient;
        const analytics = instance(mock<Analytics>());
        const selectedBuild = {
          id: uuidv4(),
          buildProfile: 'otherProfile',
        } as any as BuildFragment;
        jest
          .mocked(getArchiveAsync)
          .mockImplementation(async (_ctx: ArchiveResolverContext, _source: ArchiveSource) => {
            return {
              sourceType: ArchiveSourceType.build,
              build: selectedBuild,
            };
          });
        jest
          .mocked(refreshContextSubmitProfileAsync)
          .mockImplementation(async (ctx: SubmissionContext<Platform>, _archiveProfile: string) => {
            ctx.profile = {
              language: 'en-US',
              appleId: 'other-test@example.com',
              ascAppId: '87654321',
            };
            return ctx;
          });

        process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD = 'abcd-abcd-abcd-abcd';

        const ctx = await createSubmissionContextAsync({
          platform: Platform.IOS,
          projectDir: testProject.projectRoot,
          archiveFlags: {},
          profile: {
            language: 'en-US',
            appleId: 'test@example.com',
            ascAppId: '12345678',
          },
          nonInteractive: false,
          isVerboseFastlaneEnabled: false,
          actor: mockJester,
          graphqlClient,
          analytics,
          exp: testProject.appJSON.expo,
          projectId,
          vcsClient,
          specifiedProfile: 'specificProfile',
        });
        const command = new IosSubmitCommand(ctx);
        const submitter = await command.runAsync();
        await submitter.submitAsync();

        expect(SubmissionMutation.createIosSubmissionAsync).toHaveBeenCalledWith(graphqlClient, {
          appId: projectId,
          submittedBuildId: selectedBuild.id,
          config: {
            appleIdUsername: 'test@example.com',
            appleAppSpecificPassword: 'abcd-abcd-abcd-abcd',
            ascAppIdentifier: '12345678',
            isVerboseFastlaneEnabled: false,
          },
          archiveSource: undefined,
        });

        delete process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD;
      });
    });
  });
});
