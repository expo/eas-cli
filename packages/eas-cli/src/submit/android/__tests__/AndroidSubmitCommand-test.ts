import { Platform } from '@expo/eas-build-job';
import { AndroidReleaseStatus, AndroidReleaseTrack } from '@expo/eas-json';
import { vol } from 'memfs';
import { instance, mock } from 'ts-mockito';
import { v4 as uuidv4 } from 'uuid';

import { Analytics } from '../../../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  jester as mockJester,
  testProjectId,
} from '../../../credentials/__tests__/fixtures-constants';
import {
  AppPlatform,
  BuildFragment,
  SubmissionAndroidReleaseStatus,
  SubmissionAndroidTrack,
  SubmissionArchiveSourceType,
} from '../../../graphql/generated';
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
import { getRecentBuildsForSubmissionAsync } from '../../utils/builds';
import AndroidSubmitCommand from '../AndroidSubmitCommand';

jest.mock('fs');
jest.mock('../../../ora');
jest.mock('../../../graphql/mutations/SubmissionMutation');
jest.mock('../../../credentials/android/api/graphql/queries/AndroidAppCredentialsQuery', () => ({
  AndroidAppCredentialsQuery: {
    withCommonFieldsByApplicationIdentifierAsync: jest.fn(),
  },
}));
jest.mock('../../utils/builds');
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

describe(AndroidSubmitCommand, () => {
  const testProject = createTestProject(testProjectId, mockJester.accounts[0].name, {
    android: {
      package: 'com.expo.test.project',
    },
  });

  const fakeFiles: Record<string, string> = {
    '/apks/fake.apk': 'fake apk',
    '/google-service-account.json': JSON.stringify({
      type: 'service_account',
      private_key: 'super secret',
      client_email: 'beep-boop@iam.gserviceaccount.com',
    }),
    '/google-other-service-account.json': JSON.stringify({
      type: 'service_account',
      private_key: 'other super secret',
      client_email: 'beep-boop-blep@iam.gserviceaccount.com',
    }),
  };

  const fakeBuildFragment: Partial<BuildFragment> = {
    id: uuidv4(),
    artifacts: { buildUrl: 'http://expo.dev/fake.apk' },
    appVersion: '1.2.3',
    platform: AppPlatform.Android,
  };

  beforeAll(() => {
    vol.fromJSON({
      ...testProject.projectTree,
      ...fakeFiles,
    });
  });
  afterAll(() => {
    vol.reset();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue(mockJester.accounts[0]);
  });

  describe('non-interactive mode', () => {
    it("throws error if didn't provide serviceAccountKeyPath in the submit profile", async () => {
      const projectId = uuidv4();
      const graphqlClient = {} as any as ExpoGraphqlClient;
      const analytics = instance(mock<Analytics>());
      jest
        .mocked(getArchiveAsync)
        .mockImplementation(jest.requireActual('../../ArchiveSource').getArchiveAsync);

      const ctx = await createSubmissionContextAsync({
        platform: Platform.ANDROID,
        projectDir: testProject.projectRoot,
        archiveFlags: {
          url: 'http://expo.dev/fake.apk',
        },
        profile: {
          track: AndroidReleaseTrack.internal,
          releaseStatus: AndroidReleaseStatus.draft,
          changesNotSentForReview: false,
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
      const command = new AndroidSubmitCommand(ctx);
      await expect(
        command.runAsync().then(submitter => submitter.submitAsync())
      ).rejects.toThrowError(
        'Google Service Account Keys cannot be set up in --non-interactive mode.'
      );
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

      const ctx = await createSubmissionContextAsync({
        platform: Platform.ANDROID,
        projectDir: testProject.projectRoot,
        archiveFlags: {
          url: 'http://expo.dev/fake.apk',
        },
        profile: {
          serviceAccountKeyPath: '/google-service-account.json',
          track: AndroidReleaseTrack.internal,
          releaseStatus: AndroidReleaseStatus.draft,
          changesNotSentForReview: false,
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

      const command = new AndroidSubmitCommand(ctx);
      const submitter = await command.runAsync();
      await submitter.submitAsync();

      expect(SubmissionMutation.createAndroidSubmissionAsync).toHaveBeenCalledWith(graphqlClient, {
        appId: projectId,
        archiveSource: { type: SubmissionArchiveSourceType.Url, url: 'http://expo.dev/fake.apk' },
        config: {
          googleServiceAccountKeyJson: fakeFiles['/google-service-account.json'],
          releaseStatus: SubmissionAndroidReleaseStatus.Draft,
          track: SubmissionAndroidTrack.Internal,
          changesNotSentForReview: false,
          isVerboseFastlaneEnabled: false,
        },
      });
    });

    it('sends a request to EAS Submit when using inProgress status', async () => {
      const projectId = uuidv4();
      const graphqlClient = {} as any as ExpoGraphqlClient;
      const analytics = instance(mock<Analytics>());
      jest
        .mocked(getArchiveAsync)
        .mockImplementation(jest.requireActual('../../ArchiveSource').getArchiveAsync);

      const ctx = await createSubmissionContextAsync({
        platform: Platform.ANDROID,
        projectDir: testProject.projectRoot,
        archiveFlags: {
          url: 'http://expo.dev/fake.apk',
        },
        profile: {
          serviceAccountKeyPath: '/google-service-account.json',
          track: AndroidReleaseTrack.internal,
          releaseStatus: AndroidReleaseStatus.inProgress,
          changesNotSentForReview: false,
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

      const command = new AndroidSubmitCommand(ctx);
      const submitter = await command.runAsync();
      await submitter.submitAsync();

      expect(SubmissionMutation.createAndroidSubmissionAsync).toHaveBeenCalledWith(graphqlClient, {
        appId: projectId,
        archiveSource: { type: SubmissionArchiveSourceType.Url, url: 'http://expo.dev/fake.apk' },
        config: {
          googleServiceAccountKeyJson: fakeFiles['/google-service-account.json'],
          releaseStatus: SubmissionAndroidReleaseStatus.InProgress,
          track: SubmissionAndroidTrack.Internal,
          changesNotSentForReview: false,
          isVerboseFastlaneEnabled: false,
        },
      });
    });

    it('assigns the build ID to submission', async () => {
      const projectId = uuidv4();
      const graphqlClient = {} as any as ExpoGraphqlClient;
      const analytics = instance(mock<Analytics>());
      jest
        .mocked(getRecentBuildsForSubmissionAsync)
        .mockResolvedValueOnce([fakeBuildFragment as BuildFragment]);
      jest
        .mocked(getArchiveAsync)
        .mockImplementation(jest.requireActual('../../ArchiveSource').getArchiveAsync);

      const ctx = await createSubmissionContextAsync({
        platform: Platform.ANDROID,
        projectDir: testProject.projectRoot,
        archiveFlags: {
          latest: true,
        },
        profile: {
          serviceAccountKeyPath: '/google-service-account.json',
          track: AndroidReleaseTrack.internal,
          releaseStatus: AndroidReleaseStatus.draft,
          changesNotSentForReview: false,
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
      const command = new AndroidSubmitCommand(ctx);
      const submitter = await command.runAsync();
      await submitter.submitAsync();

      expect(SubmissionMutation.createAndroidSubmissionAsync).toHaveBeenCalledWith(graphqlClient, {
        appId: projectId,
        config: {
          googleServiceAccountKeyJson: fakeFiles['/google-service-account.json'],
          releaseStatus: SubmissionAndroidReleaseStatus.Draft,
          track: SubmissionAndroidTrack.Internal,
          changesNotSentForReview: false,
          isVerboseFastlaneEnabled: false,
        },
        submittedBuildId: fakeBuildFragment.id,
      });
    });
    describe('build selected from EAS', () => {
      it('sends a request to EAS Submit', async () => {
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
              serviceAccountKeyPath: '/google-other-service-account.json',
              track: AndroidReleaseTrack.beta,
              releaseStatus: AndroidReleaseStatus.draft,
              changesNotSentForReview: false,
              applicationId: 'otherAppId',
            };
            return ctx;
          });

        const ctx = await createSubmissionContextAsync({
          platform: Platform.ANDROID,
          projectDir: testProject.projectRoot,
          archiveFlags: {},
          profile: {
            serviceAccountKeyPath: '/google-service-account.json',
            track: AndroidReleaseTrack.internal,
            releaseStatus: AndroidReleaseStatus.draft,
            changesNotSentForReview: false,
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

        const command = new AndroidSubmitCommand(ctx);
        const submitter = await command.runAsync();
        await submitter.submitAsync();

        expect(SubmissionMutation.createAndroidSubmissionAsync).toHaveBeenCalledWith(
          graphqlClient,
          {
            appId: projectId,
            archiveSource: undefined,
            config: {
              googleServiceAccountKeyJson: fakeFiles['/google-other-service-account.json'],
              releaseStatus: SubmissionAndroidReleaseStatus.Draft,
              track: SubmissionAndroidTrack.Beta,
              changesNotSentForReview: false,
              rollout: undefined,
              isVerboseFastlaneEnabled: false,
            },
            submittedBuildId: selectedBuild.id,
          }
        );
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

        const ctx = await createSubmissionContextAsync({
          platform: Platform.ANDROID,
          projectDir: testProject.projectRoot,
          archiveFlags: {},
          profile: {
            serviceAccountKeyPath: '/google-service-account.json',
            track: AndroidReleaseTrack.internal,
            releaseStatus: AndroidReleaseStatus.draft,
            changesNotSentForReview: false,
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

        const command = new AndroidSubmitCommand(ctx);
        const submitter = await command.runAsync();
        await submitter.submitAsync();

        expect(SubmissionMutation.createAndroidSubmissionAsync).toHaveBeenCalledWith(
          graphqlClient,
          {
            appId: projectId,
            archiveSource: undefined,
            config: {
              googleServiceAccountKeyJson: fakeFiles['/google-service-account.json'],
              releaseStatus: SubmissionAndroidReleaseStatus.Draft,
              track: SubmissionAndroidTrack.Internal,
              changesNotSentForReview: false,
              rollout: undefined,
              isVerboseFastlaneEnabled: false,
            },
            submittedBuildId: selectedBuild.id,
          }
        );
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
              serviceAccountKeyPath: '/google-other-service-account.json',
              track: AndroidReleaseTrack.beta,
              releaseStatus: AndroidReleaseStatus.draft,
              changesNotSentForReview: false,
              applicationId: 'otherAppId',
            };
            return ctx;
          });

        const ctx = await createSubmissionContextAsync({
          platform: Platform.ANDROID,
          projectDir: testProject.projectRoot,
          archiveFlags: {},
          profile: {
            serviceAccountKeyPath: '/google-service-account.json',
            track: AndroidReleaseTrack.internal,
            releaseStatus: AndroidReleaseStatus.draft,
            changesNotSentForReview: false,
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

        const command = new AndroidSubmitCommand(ctx);
        const submitter = await command.runAsync();
        await submitter.submitAsync();

        expect(SubmissionMutation.createAndroidSubmissionAsync).toHaveBeenCalledWith(
          graphqlClient,
          {
            appId: projectId,
            archiveSource: undefined,
            config: {
              googleServiceAccountKeyJson: fakeFiles['/google-service-account.json'],
              releaseStatus: SubmissionAndroidReleaseStatus.Draft,
              track: SubmissionAndroidTrack.Internal,
              changesNotSentForReview: false,
              rollout: undefined,
              isVerboseFastlaneEnabled: false,
            },
            submittedBuildId: selectedBuild.id,
          }
        );
      });
    });
  });
});
