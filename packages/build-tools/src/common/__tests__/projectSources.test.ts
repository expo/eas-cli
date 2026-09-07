import {
  ArchiveSourceType,
  BuildMode,
  BuildTrigger,
  ErrorCode,
  Job,
  Platform,
  SystemError,
  Workflow,
} from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { randomBytes, randomUUID } from 'crypto';
import { vol } from 'memfs';
import fetch, { Response } from 'node-fetch';
import { setTimeout } from 'timers/promises';

import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { shallowCloneRepositoryAsync } from '../git';
import { prepareProjectSourcesAsync, unpackTarGzAsync } from '../projectSources';

jest.mock('@expo/turtle-spawn');
jest.mock('node-fetch');
jest.mock('../git');
jest.mock('@expo/downloader');
jest.mock('@urql/core');

describe('projectSources', () => {
  it('makes extracted project sources readable and writable by the worker', async () => {
    const logger = createMockLogger();

    await unpackTarGzAsync({
      source: '/workingdir/project.tar.gz',
      destination: '/workingdir/build',
      logger,
    });

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'tar',
      ['-C', '/workingdir/build', '--strip-components', '1', '-zxf', '/workingdir/project.tar.gz'],
      { logger }
    );
    expect(spawn).toHaveBeenNthCalledWith(2, 'chmod', ['-R', 'u+rwX', '/workingdir/build'], {
      logger,
    });
    expect(logger.info).toHaveBeenCalledWith('Normalizing project source permissions');
  });

  it('uses the refreshed repository URL', async () => {
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
          repositoryUrl: 'https://x-access-token:1234567890@github.com/expo/eas-cli.git',
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
              repositoryUrl: 'https://x-access-token:qwerty@github.com/expo/eas-cli.git',
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
          repositoryUrl: 'https://x-access-token:qwerty@github.com/expo/eas-cli.git',
        },
      })
    );
  });

  it.each(['http', 'network', 'json', 'schema'])(
    'throws a system error if refresh fails (%s)',
    async failure => {
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
            repositoryUrl: 'https://x-access-token:1234567890@github.com/expo/eas-cli.git',
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
      const cause = new Error('Source request failed');
      fetchMock.mockImplementation(async () => {
        if (failure === 'network') {
          throw cause;
        }
        return {
          ok: failure !== 'http',
          status: failure === 'http' ? 500 : 200,
          json: async () => {
            if (failure === 'json') {
              throw cause;
            }
            return { data: { repository_url: 'https://github.com/expo/eas-cli.git' } };
          },
        } as Response;
      });

      const result = prepareProjectSourcesAsync(ctx, ctx.buildDirectory);
      await expect(result).rejects.toBeInstanceOf(SystemError);
      await expect(result).rejects.toMatchObject({
        errorCode: ErrorCode.SERVER_ERROR,
        cause: expect.any(Error),
      });
      if (failure === 'network') {
        await expect(result).rejects.toMatchObject({ cause });
      }
      expect(shallowCloneRepositoryAsync).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    },
    15_000
  );

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
          repositoryUrl: 'https://x-access-token:1234567890@github.com/expo/eas-cli.git',
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
              repositoryUrl: 'https://x-access-token:qwerty@github.com/expo/eas-cli.git',
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
          repositoryUrl: 'https://x-access-token:qwerty@github.com/expo/eas-cli.git',
        },
      })
    );
  }, 15_000);

  it(`throws a system error if refresh configuration is missing`, async () => {
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
          repositoryUrl: 'https://x-access-token:1234567890@github.com/expo/eas-cli.git',
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

    await expect(prepareProjectSourcesAsync(ctx, ctx.buildDirectory)).rejects.toMatchObject({
      errorCode: ErrorCode.SERVER_ERROR,
      cause: new Error('EAS_BUILD_ID is not set'),
    });
    expect(shallowCloneRepositoryAsync).not.toHaveBeenCalled();
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
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: ctx.job.projectArchive }),
      } as Response);

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
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: ctx.job.projectArchive }),
      } as Response);

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
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: ctx.job.projectArchive }),
      } as Response);

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

describe('local project sources', () => {
  function createContext(type: ArchiveSourceType): BuildContext<Job> {
    return new BuildContext(
      {
        platform: Platform.IOS,
        projectArchive: { type, path: '/source.tar.gz' },
      } as Job,
      {
        env: { EAS_BUILD_RUNNER: 'local-build-plugin', __API_SERVER_URL: 'https://api.expo.dev' },
        workingdir: '/workingdir',
        logger: createMockLogger(),
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        uploadArtifact: jest.fn(),
      }
    );
  }

  it('copies and unpacks a PATH source without fetching from www', async () => {
    await vol.promises.mkdir('/workingdir', { recursive: true });
    await vol.promises.writeFile('/source.tar.gz', 'local archive');
    const ctx = createContext(ArchiveSourceType.PATH);
    await expect(prepareProjectSourcesAsync(ctx, ctx.buildDirectory)).resolves.toEqual({
      handled: true,
    });
    expect(await vol.promises.readFile('/workingdir/project.tar.gz', 'utf8')).toBe('local archive');
    expect(spawn).toHaveBeenCalledWith(
      'tar',
      ['-C', ctx.buildDirectory, '--strip-components', '1', '-zxf', '/workingdir/project.tar.gz'],
      { logger: ctx.logger }
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(shallowCloneRepositoryAsync).not.toHaveBeenCalled();
  });

  it.each(Object.values(ArchiveSourceType).filter(type => type !== ArchiveSourceType.PATH))(
    'rejects local %s sources before fetching or unpacking',
    async type => {
      const ctx = createContext(type);
      await expect(prepareProjectSourcesAsync(ctx, ctx.buildDirectory)).rejects.toThrow(
        'Local builds require a PATH project source'
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
      expect(shallowCloneRepositoryAsync).not.toHaveBeenCalled();
    }
  );
});
