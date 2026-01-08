import { randomBytes, randomUUID } from 'crypto';
import { setTimeout } from 'timers/promises';

import {
  ArchiveSourceType,
  BuildMode,
  BuildTrigger,
  Job,
  Platform,
  Workflow,
} from '@expo/eas-build-job';
import fetch, { Response } from 'node-fetch';
import { vol } from 'memfs';

import { BuildContext } from '../../context';
import { createMockLogger } from '../../__tests__/utils/logger';
import { prepareProjectSourcesAsync } from '../projectSources';
import { shallowCloneRepositoryAsync } from '../git';

jest.mock('@expo/turtle-spawn');
jest.mock('node-fetch');
jest.mock('../git');
jest.mock('@expo/downloader');
jest.mock('@urql/core');

describe('projectSources', () => {
  it('should use the refreshed repository URL', async () => {
    const robotAccessToken = randomUUID();
    const buildId = randomUUID();
    await vol.promises.mkdir('/workingdir/environment-secrets/', { recursive: true });

    const gitCommitHash = randomBytes(20).toString('hex');

    const ctx = new BuildContext(
      {
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        type: Workflow.MANAGED,
        mode: BuildMode.BUILD,
        initiatingUserId: randomUUID(),
        appId: randomUUID(),
        projectArchive: {
          type: ArchiveSourceType.GIT,
          repositoryUrl: 'https://x-access-token:1234567890@github.com/expo/eas-build.git',
          gitRef: 'refs/heads/main',
          gitCommitHash,
        },
        platform: Platform.IOS,
        secrets: {
          robotAccessToken,
          environmentSecrets: [],
        },
      } as Job,
      {
        env: {
          __API_SERVER_URL: 'https://api.expo.dev',
          EXPO_TOKEN: robotAccessToken,
          EAS_BUILD_ID: buildId,
          EAS_BUILD_RUNNER: 'eas-build',
        },
        workingdir: '/workingdir',
        logger: createMockLogger(),
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        uploadArtifact: jest.fn(),
      }
    );
    const fetchMock = jest.mocked(fetch);
    fetchMock.mockImplementation(
      async () =>
        ({
          ok: true,
          json: async () => ({
            data: {
              gitRef: 'refs/heads/main',
              gitCommitHash,
              repositoryUrl: 'https://x-access-token:qwerty@github.com/expo/eas-build.git',
              type: ArchiveSourceType.GIT,
            },
          }),
        }) as Response
    );

    await prepareProjectSourcesAsync(ctx, ctx.buildDirectory);
    expect(shallowCloneRepositoryAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        archiveSource: {
          ...ctx.job.projectArchive,
          repositoryUrl: 'https://x-access-token:qwerty@github.com/expo/eas-build.git',
        },
      })
    );
  });

  it('should fallback to the original repository URL if the refresh fails', async () => {
    const robotAccessToken = randomUUID();
    const buildId = randomUUID();
    await vol.promises.mkdir('/workingdir/environment-secrets/', { recursive: true });

    const ctx = new BuildContext(
      {
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        type: Workflow.MANAGED,
        mode: BuildMode.BUILD,
        initiatingUserId: randomUUID(),
        appId: randomUUID(),
        projectArchive: {
          type: ArchiveSourceType.GIT,
          repositoryUrl: 'https://x-access-token:1234567890@github.com/expo/eas-build.git',
          gitRef: 'refs/heads/main',
          gitCommitHash: randomBytes(20).toString('hex'),
        },
        platform: Platform.IOS,
        secrets: {
          robotAccessToken,
          environmentSecrets: [],
        },
      } as Job,
      {
        env: {
          __API_SERVER_URL: 'https://api.expo.dev',
          EXPO_TOKEN: robotAccessToken,
          EAS_BUILD_ID: buildId,
          EAS_BUILD_RUNNER: 'eas-build',
        },
        workingdir: '/workingdir',
        logger: createMockLogger(),
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        uploadArtifact: jest.fn(),
      }
    );
    const fetchMock = jest.mocked(fetch);
    fetchMock.mockImplementation(
      async () =>
        ({
          ok: false,
          text: async () => 'Failed to generate repository URL',
        }) as Response
    );

    await prepareProjectSourcesAsync(ctx, ctx.buildDirectory);
    expect(shallowCloneRepositoryAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        archiveSource: {
          ...ctx.job.projectArchive,
          repositoryUrl: 'https://x-access-token:1234567890@github.com/expo/eas-build.git',
        },
      })
    );
    fetchMock.mockImplementation(
      async () =>
        ({
          ok: false,
          json: async () => ({
            // repositoryUrl is the right key
            repository_url: 'https://x-access-token:qwerty@github.com/expo/eas-build.git',
          }),
        }) as Response
    );

    await prepareProjectSourcesAsync(ctx, ctx.buildDirectory);
    expect(shallowCloneRepositoryAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        archiveSource: {
          ...ctx.job.projectArchive,
          repositoryUrl: 'https://x-access-token:1234567890@github.com/expo/eas-build.git',
        },
      })
    );

    fetchMock.mockImplementation(
      async () =>
        ({
          ok: false,
          json: () => Promise.reject(new Error('Failed to generate repository URL')),
        }) as Response
    );

    await prepareProjectSourcesAsync(ctx, ctx.buildDirectory);
    expect(shallowCloneRepositoryAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        archiveSource: {
          ...ctx.job.projectArchive,
          repositoryUrl: 'https://x-access-token:1234567890@github.com/expo/eas-build.git',
        },
      })
    );

    expect(shallowCloneRepositoryAsync).toHaveBeenCalledTimes(3);
  }, 15_000);

  it('should retry fetching the repository URL', async () => {
    const robotAccessToken = randomUUID();
    const buildId = randomUUID();
    await vol.promises.mkdir('/workingdir/environment-secrets/', { recursive: true });

    const gitCommitHash = randomBytes(20).toString('hex');

    const ctx = new BuildContext(
      {
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        type: Workflow.MANAGED,
        mode: BuildMode.BUILD,
        initiatingUserId: randomUUID(),
        appId: randomUUID(),
        projectArchive: {
          type: ArchiveSourceType.GIT,
          repositoryUrl: 'https://x-access-token:1234567890@github.com/expo/eas-build.git',
          gitRef: 'refs/heads/main',
          gitCommitHash,
        },
        platform: Platform.IOS,
        secrets: {
          robotAccessToken,
          environmentSecrets: [],
        },
      } as Job,
      {
        env: {
          __API_SERVER_URL: 'https://api.expo.dev',
          EXPO_TOKEN: robotAccessToken,
          EAS_BUILD_ID: buildId,
          EAS_BUILD_RUNNER: 'eas-build',
        },
        workingdir: '/workingdir',
        logger: createMockLogger(),
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        uploadArtifact: jest.fn(),
      }
    );
    const fetchMock = jest.mocked(fetch);
    fetchMock.mockImplementationOnce(
      async () =>
        ({
          ok: false,
          text: async () => 'Failed to generate repository URL',
        }) as Response
    );
    fetchMock.mockImplementationOnce(
      async () =>
        ({
          ok: true,
          json: async () => ({
            data: {
              repositoryUrl: 'https://x-access-token:qwerty@github.com/expo/eas-build.git',
              gitRef: 'refs/heads/main',
              gitCommitHash,
              type: ArchiveSourceType.GIT,
            },
          }),
        }) as Response
    );

    await prepareProjectSourcesAsync(ctx, ctx.buildDirectory);
    expect(shallowCloneRepositoryAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        archiveSource: {
          ...ctx.job.projectArchive,
          repositoryUrl: 'https://x-access-token:qwerty@github.com/expo/eas-build.git',
        },
      })
    );
  }, 15_000);

  it(`should fallback to the original repository URL if we're missing some config`, async () => {
    const robotAccessToken = randomUUID();
    await vol.promises.mkdir('/workingdir/environment-secrets/', { recursive: true });
    const logger = createMockLogger();

    const ctx = new BuildContext(
      {
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        type: Workflow.MANAGED,
        mode: BuildMode.BUILD,
        initiatingUserId: randomUUID(),
        appId: randomUUID(),
        projectArchive: {
          type: ArchiveSourceType.GIT,
          repositoryUrl: 'https://x-access-token:1234567890@github.com/expo/eas-build.git',
          gitRef: 'refs/heads/main',
          gitCommitHash: randomBytes(20).toString('hex'),
        },
        platform: Platform.IOS,
        secrets: {
          robotAccessToken,
          environmentSecrets: [],
        },
      } as Job,
      {
        env: {
          __API_SERVER_URL: 'https://api.expo.dev',
          EXPO_TOKEN: robotAccessToken,
          EAS_BUILD_RUNNER: 'eas-build',
          // EAS_BUILD_ID: buildId,
        },
        workingdir: '/workingdir',
        logger,
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        uploadArtifact: jest.fn(),
      }
    );

    await prepareProjectSourcesAsync(ctx, ctx.buildDirectory);

    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Failed to refresh project archive, falling back to the original one'
    );
  });

  describe('uploadProjectMetadataAsFireAndForget', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should upload project metadata for build job with URL archive type', async () => {
      const robotAccessToken = randomUUID();
      const buildId = randomUUID();
      const bucketKey = `test-bucket-key-${randomUUID()}`;
      await vol.promises.mkdir('/workingdir/build', { recursive: true });
      await vol.promises.writeFile('/workingdir/build/package.json', '{}');
      await vol.promises.writeFile('/workingdir/build/README.md', 'Hello, world!');

      const mockGraphqlMutation = jest.fn();
      mockGraphqlMutation
        .mockReturnValueOnce({
          toPromise: () =>
            Promise.resolve({
              data: {
                uploadSession: {
                  createUploadSession: {
                    url: 'https://storage.example.com/upload',
                    bucketKey,
                    headers: { 'x-custom-header': 'value' },
                  },
                },
              },
            }),
        })
        .mockReturnValueOnce({
          toPromise: () =>
            Promise.resolve({
              data: {
                build: {
                  updateBuildMetadata: {
                    id: buildId,
                  },
                },
              },
            }),
        });

      const ctx = new BuildContext(
        {
          triggeredBy: BuildTrigger.EAS_CLI,
          type: Workflow.MANAGED,
          mode: BuildMode.BUILD,
          initiatingUserId: randomUUID(),
          appId: randomUUID(),
          projectArchive: {
            type: ArchiveSourceType.URL,
            url: 'https://example.com/project.tar.gz',
          },
          platform: Platform.IOS,
          secrets: {
            robotAccessToken,
            environmentSecrets: [],
          },
        } as Job,
        {
          env: {
            __API_SERVER_URL: 'https://api.expo.dev',
            EXPO_TOKEN: robotAccessToken,
            EAS_BUILD_ID: buildId,
            EAS_BUILD_RUNNER: 'eas-build',
          },
          workingdir: '/workingdir',
          logger: createMockLogger(),
          logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
          uploadArtifact: jest.fn(),
        }
      );

      ctx.graphqlClient.mutation = mockGraphqlMutation as any;

      const fetchMock = jest.mocked(fetch);
      fetchMock.mockImplementation(async () => ({ ok: true }) as Response);

      // Call prepareProjectSourcesAsync and don't await metadata upload
      await prepareProjectSourcesAsync(ctx, ctx.buildDirectory);

      // Wait for the fire-and-forget async operation to complete
      await setTimeout(1000);

      // Verify the upload session was created
      expect(mockGraphqlMutation).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({})
      );

      // Verify metadata was uploaded to storage
      expect(fetchMock).toHaveBeenCalledWith(
        'https://storage.example.com/upload',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'x-custom-header': 'value' },
          body: '{"archiveContent":["project/README.md","project/package.json"]}',
        })
      );

      // Verify build metadata was updated
      expect(mockGraphqlMutation).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({
          buildId,
          projectMetadataFile: {
            type: 'GCS',
            bucketKey,
          },
        })
      );
    });

    it('should not await the metadata upload (fire-and-forget)', async () => {
      const robotAccessToken = randomUUID();
      const buildId = randomUUID();
      await vol.promises.mkdir('/workingdir/build', { recursive: true });
      await vol.promises.writeFile('/workingdir/build/app.json', '{}');

      let uploadCompleted = false;
      const mockGraphqlMutation = jest.fn();
      mockGraphqlMutation
        .mockReturnValueOnce({
          toPromise: async () => {
            // Simulate a slow upload
            await setTimeout(100);
            uploadCompleted = true;
            return {
              data: {
                uploadSession: {
                  createUploadSession: {
                    url: 'https://storage.example.com/upload',
                    bucketKey: 'test-key',
                    headers: {},
                  },
                },
              },
            };
          },
        })
        .mockReturnValueOnce({
          toPromise: () =>
            Promise.resolve({
              data: {
                build: {
                  updateBuildMetadata: {
                    id: buildId,
                  },
                },
              },
            }),
        });

      const ctx = new BuildContext(
        {
          triggeredBy: BuildTrigger.EAS_CLI,
          type: Workflow.MANAGED,
          mode: BuildMode.BUILD,
          initiatingUserId: randomUUID(),
          appId: randomUUID(),
          projectArchive: {
            type: ArchiveSourceType.URL,
            url: 'https://example.com/project.tar.gz',
          },
          platform: Platform.IOS,
          secrets: {
            robotAccessToken,
            environmentSecrets: [],
          },
        } as Job,
        {
          env: {
            __API_SERVER_URL: 'https://api.expo.dev',
            EXPO_TOKEN: robotAccessToken,
            EAS_BUILD_ID: buildId,
            EAS_BUILD_RUNNER: 'eas-build',
          },
          workingdir: '/workingdir',
          logger: createMockLogger(),
          logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
          uploadArtifact: jest.fn(),
        }
      );

      ctx.graphqlClient.mutation = mockGraphqlMutation as any;

      const fetchMock = jest.mocked(fetch);
      fetchMock.mockResolvedValue({ ok: true } as Response);

      const startTime = Date.now();
      await prepareProjectSourcesAsync(ctx, ctx.buildDirectory);
      const endTime = Date.now();

      // prepareProjectSourcesAsync should complete quickly without waiting for upload
      expect(endTime - startTime).toBeLessThan(50);
      // Upload should not be completed yet
      expect(uploadCompleted).toBe(false);

      // Wait for the fire-and-forget operation to complete
      await setTimeout(150);

      // Now the upload should be completed
      expect(uploadCompleted).toBe(true);
    });

    it('should handle upload errors gracefully without failing the build', async () => {
      const robotAccessToken = randomUUID();
      const buildId = randomUUID();
      await vol.promises.mkdir('/workingdir/build', { recursive: true });
      await vol.promises.writeFile('/workingdir/build/index.js', 'console.log("test");');

      const mockGraphqlMutation = jest.fn();
      mockGraphqlMutation.mockReturnValue({
        toPromise: () => Promise.reject(new Error('Upload failed')),
      });

      const logger = createMockLogger();
      const ctx = new BuildContext(
        {
          triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
          type: Workflow.MANAGED,
          mode: BuildMode.BUILD,
          initiatingUserId: randomUUID(),
          appId: randomUUID(),
          projectArchive: {
            type: ArchiveSourceType.URL,
            url: 'https://example.com/project.tar.gz',
          },
          platform: Platform.IOS,
          secrets: {
            robotAccessToken,
            environmentSecrets: [],
          },
        } as Job,
        {
          env: {
            __API_SERVER_URL: 'https://api.expo.dev',
            EXPO_TOKEN: robotAccessToken,
            EAS_BUILD_ID: buildId,
            EAS_BUILD_RUNNER: 'eas-build',
          },
          workingdir: '/workingdir',
          logger,
          logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
          uploadArtifact: jest.fn(),
        }
      );

      ctx.graphqlClient.mutation = mockGraphqlMutation as any;

      const fetchMock = jest.mocked(fetch);
      fetchMock.mockResolvedValue({ ok: true } as Response);

      // Should not throw even though upload will fail
      await expect(prepareProjectSourcesAsync(ctx, ctx.buildDirectory)).resolves.not.toThrow();

      // Wait for the fire-and-forget operation to complete
      await setTimeout(100);

      // Verify that a warning was logged
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to upload project metadata')
      );
    });
  });
});
