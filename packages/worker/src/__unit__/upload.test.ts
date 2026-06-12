import { BuildContext, GCS } from '@expo/build-tools';
import { Job, errors } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { randomBytes, randomUUID } from 'crypto';
import { vol } from 'memfs';
import { Response } from 'node-fetch';

import {
  uploadApplicationArchiveAsync,
  uploadBuildArtifactsAsync,
  uploadWorkflowArtifactAsync,
} from '../upload';
import { turtleFetch } from '../utils/turtleFetch';

const mockLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as bunyan;

jest.mock('fs');
jest.mock('fs/promises');
jest.mock('../utils/turtleFetch', () => ({
  ...jest.requireActual('../utils/turtleFetch'),
  turtleFetch: jest.fn(),
}));
const turtleFetchMock = jest.mocked(turtleFetch);
jest.mock('../config', () => ({
  loggers: {
    base: {
      name: 'test',
    },
  },
  sentry: {},
  rudderstack: {},
  wwwApiV2BaseUrl: 'https://api.expo.test/v2/',
}));

describe(uploadApplicationArchiveAsync.name, () => {
  it('should throw if configuration is missing', async () => {
    // @ts-expect-error
    const ctx: BuildContext<Job> = {
      env: {},
      job: {
        secrets: {},
      } as Job,
      logger: mockLogger,
    };
    vol.fromJSON({
      './artifact.ipa': JSON.stringify(randomBytes(20)),
    });

    await expect(
      uploadApplicationArchiveAsync(ctx, {
        artifactPaths: ['./artifact.ipa'],
        buildId: 'buildId',
        logger: ctx.logger,
      })
    ).rejects.toMatchObject({
      errorCode: errors.ErrorCode.SERVER_ERROR,
      trackingCode: 'EAS_BUILD_UPLOAD_APPLICATION_ARCHIVE_FAILED',
      message: 'Failed to upload application archive.',
      cause: expect.objectContaining({
        message: expect.stringContaining('env variables are not set'),
      }),
    });

    ctx.env.__WORKFLOW_JOB_ID = randomUUID();

    await expect(
      uploadApplicationArchiveAsync(ctx, {
        artifactPaths: ['./artifact.ipa'],
        buildId: 'buildId',
        logger: ctx.logger,
      })
    ).rejects.toMatchObject({
      errorCode: errors.ErrorCode.SERVER_ERROR,
      trackingCode: 'EAS_BUILD_UPLOAD_APPLICATION_ARCHIVE_FAILED',
      message: 'Failed to upload application archive.',
      cause: expect.objectContaining({
        message: expect.stringContaining('robot access token is not set'),
      }),
    });
  });

  it('should upload the application archive', async () => {
    vol.fromJSON({
      './artifact.ipa': JSON.stringify(randomBytes(20)),
    });
    const workflowJobId = randomUUID();

    // @ts-expect-error
    const ctx: BuildContext<Job> = {
      env: {
        __WORKFLOW_JOB_ID: workflowJobId,
      },
      job: {
        secrets: {
          robotAccessToken: 'fake-token',
        },
      } as Job,
      logger: mockLogger,
    };

    const bucketKey = `test/${randomUUID()}/artifact.ipa`;
    const uploadUrl = `https://upload.url/${randomUUID()}`;
    const testSignedUploadAuthorization = randomUUID();

    turtleFetchMock.mockImplementation(async url => {
      if (url === `https://api.expo.test/v2/workflows/${workflowJobId}/artifacts/`) {
        return {
          ok: true,
          status: 200,
        } as Response;
      } else if (url === `https://api.expo.test/v2/workflows/${workflowJobId}/upload-sessions/`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              bucketKey,
              url: uploadUrl,
              headers: {
                authorization: testSignedUploadAuthorization,
              },
              storageType: 'GCS',
            },
          }),
        } as Response;
      } else {
        return {
          ok: false,
          status: 404,
        } as Response;
      }
    });

    await uploadApplicationArchiveAsync(ctx, {
      artifactPaths: ['./artifact.ipa'],
      buildId: randomUUID(),
      logger: ctx.logger,
    });

    expect(GCS.uploadWithSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        signedUrl: {
          url: uploadUrl,
          headers: {
            authorization: testSignedUploadAuthorization,
          },
        },
      })
    );

    expect(turtleFetchMock).toHaveBeenCalledTimes(2);
    expect(turtleFetchMock).toHaveBeenNthCalledWith(
      1,
      `https://api.expo.test/v2/workflows/${workflowJobId}/upload-sessions/`,
      'POST',
      expect.objectContaining({
        json: { filename: expect.any(String), name: expect.any(String), size: expect.any(Number) },
        headers: {
          Authorization: `Bearer ${ctx.job.secrets!.robotAccessToken}`,
        },
        retries: 2,
        retryIntervalMs: 1000,
        logger: ctx.logger,
      })
    );
    expect(turtleFetchMock).toHaveBeenNthCalledWith(
      2,
      `https://api.expo.test/v2/workflows/${workflowJobId}/artifacts/`,
      'POST',
      expect.objectContaining({
        json: { source: { bucketKey, type: 'GCS' }, type: 'applicationArchive' },
        headers: {
          Authorization: `Bearer ${ctx.job.secrets!.robotAccessToken}`,
        },
        retries: 2,
        retryIntervalMs: 1000,
        logger: ctx.logger,
      })
    );
  });

  it('should throw a system error if the application archive upload fails', async () => {
    vol.fromJSON({
      './artifact.ipa': JSON.stringify(randomBytes(20)),
    });
    const workflowJobId = randomUUID();

    // @ts-expect-error
    const ctx: BuildContext<Job> = {
      env: {
        __WORKFLOW_JOB_ID: workflowJobId,
      },
      job: {
        secrets: {
          robotAccessToken: 'fake-token',
        },
      } as Job,
      logger: mockLogger,
    };

    const bucketKey = `test/${randomUUID()}/artifact.ipa`;
    const uploadUrl = `https://upload.url/${randomUUID()}`;
    const testSignedUploadAuthorization = randomUUID();
    const uploadError = new Error('upload failed');

    turtleFetchMock.mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            bucketKey,
            url: uploadUrl,
            headers: {
              authorization: testSignedUploadAuthorization,
            },
            storageType: 'GCS',
          },
        }),
      } as Response;
    });
    jest.mocked(GCS.uploadWithSignedUrl).mockRejectedValueOnce(uploadError);

    let thrownError: unknown;
    try {
      await uploadApplicationArchiveAsync(ctx, {
        artifactPaths: ['./artifact.ipa'],
        buildId: randomUUID(),
        logger: ctx.logger,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(errors.SystemError);
    expect(thrownError).toMatchObject({
      errorCode: errors.ErrorCode.SERVER_ERROR,
      trackingCode: 'EAS_BUILD_UPLOAD_APPLICATION_ARCHIVE_FAILED',
      message: 'Failed to upload application archive.',
      buildPhase: undefined,
      metadata: expect.objectContaining({
        filename: expect.stringMatching(/^application-.*\.ipa$/),
        size: expect.any(Number),
        url: uploadUrl,
        headers: {
          authorization: testSignedUploadAuthorization,
        },
      }),
      cause: uploadError,
    });
  });
});

describe(uploadBuildArtifactsAsync.name, () => {
  it('should throw if configuration is missing', async () => {
    // @ts-expect-error
    const ctx: BuildContext<Job> = {
      env: {},
      job: {
        secrets: {},
      } as Job,
      logger: mockLogger,
    };
    vol.fromJSON({
      './video.mp4': JSON.stringify(randomBytes(20)),
    });
    await expect(
      uploadBuildArtifactsAsync(ctx, {
        artifactPaths: ['./video.mp4'],
        buildId: 'buildId',
        logger: ctx.logger,
      })
    ).rejects.toMatchObject({
      errorCode: errors.ErrorCode.SERVER_ERROR,
      trackingCode: 'EAS_BUILD_UPLOAD_BUILD_ARTIFACTS_FAILED',
      message: 'Failed to upload build artifacts.',
      cause: expect.objectContaining({
        message: expect.stringContaining('env variables are not set'),
      }),
    });
    ctx.env.__WORKFLOW_JOB_ID = randomUUID();
    await expect(
      uploadBuildArtifactsAsync(ctx, {
        artifactPaths: ['./video.mp4'],
        buildId: 'buildId',
        logger: ctx.logger,
      })
    ).rejects.toMatchObject({
      errorCode: errors.ErrorCode.SERVER_ERROR,
      trackingCode: 'EAS_BUILD_UPLOAD_BUILD_ARTIFACTS_FAILED',
      message: 'Failed to upload build artifacts.',
      cause: expect.objectContaining({
        message: expect.stringContaining('robot access token is not set'),
      }),
    });
  });

  it('should upload the build artifacts', async () => {
    vol.fromJSON({
      './video.mp4': JSON.stringify(randomBytes(20)),
    });
    const workflowJobId = randomUUID();
    // @ts-expect-error
    const ctx: BuildContext<Job> = {
      env: {
        __WORKFLOW_JOB_ID: workflowJobId,
      },
      job: {
        secrets: {
          robotAccessToken: 'fake-token',
        },
      } as Job,
      logger: mockLogger,
    };
    const bucketKey = `test/${randomUUID()}/artifact.ipa`;
    const uploadUrl = `https://upload.url/${randomUUID()}`;
    const testSignedUploadAuthorization = randomUUID();
    turtleFetchMock.mockImplementation(async url => {
      if (url === `https://api.expo.test/v2/workflows/${workflowJobId}/artifacts/`) {
        return {
          ok: true,
          status: 200,
        } as Response;
      } else if (url === `https://api.expo.test/v2/workflows/${workflowJobId}/upload-sessions/`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              bucketKey,
              url: uploadUrl,
              headers: {
                authorization: testSignedUploadAuthorization,
              },
              storageType: 'GCS',
            },
          }),
        } as Response;
      } else {
        return {
          ok: false,
          status: 404,
        } as Response;
      }
    });
    await uploadBuildArtifactsAsync(ctx, {
      artifactPaths: ['./video.mp4'],
      buildId: randomUUID(),
      logger: ctx.logger,
    });
    expect(GCS.uploadWithSignedUrl).toHaveBeenCalledTimes(1);
    expect(GCS.uploadWithSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        signedUrl: {
          url: uploadUrl,
          headers: {
            authorization: testSignedUploadAuthorization,
          },
        },
      })
    );
    expect(turtleFetchMock).toHaveBeenCalledTimes(2);
    expect(turtleFetchMock).toHaveBeenNthCalledWith(
      1,
      `https://api.expo.test/v2/workflows/${workflowJobId}/upload-sessions/`,
      'POST',
      expect.objectContaining({
        json: { filename: expect.any(String), name: expect.any(String), size: expect.any(Number) },
        headers: {
          Authorization: `Bearer ${ctx.job.secrets!.robotAccessToken}`,
        },
        retries: 2,
        retryIntervalMs: 1000,
        logger: ctx.logger,
      })
    );
    expect(turtleFetchMock).toHaveBeenNthCalledWith(
      2,
      `https://api.expo.test/v2/workflows/${workflowJobId}/artifacts/`,
      'POST',
      expect.objectContaining({
        json: { source: { bucketKey, type: 'GCS' }, type: 'buildArtifacts' },
        headers: {
          Authorization: `Bearer ${ctx.job.secrets!.robotAccessToken}`,
        },
        retries: 2,
        retryIntervalMs: 1000,
        logger: ctx.logger,
      })
    );
  });

  it('should throw a system error if the build artifacts upload fails', async () => {
    vol.fromJSON({
      './video.mp4': JSON.stringify(randomBytes(20)),
    });
    const workflowJobId = randomUUID();
    // @ts-expect-error
    const ctx: BuildContext<Job> = {
      env: {
        __WORKFLOW_JOB_ID: workflowJobId,
      },
      job: {
        secrets: {
          robotAccessToken: 'fake-token',
        },
      } as Job,
      logger: mockLogger,
    };
    const bucketKey = `test/${randomUUID()}/artifact.ipa`;
    const uploadUrl = `https://upload.url/${randomUUID()}`;
    const testSignedUploadAuthorization = randomUUID();
    const uploadError = new Error('upload failed');
    turtleFetchMock.mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            bucketKey,
            url: uploadUrl,
            headers: {
              authorization: testSignedUploadAuthorization,
            },
            storageType: 'GCS',
          },
        }),
      } as Response;
    });
    jest.mocked(GCS.uploadWithSignedUrl).mockRejectedValueOnce(uploadError);

    let thrownError: unknown;
    try {
      await uploadBuildArtifactsAsync(ctx, {
        artifactPaths: ['./video.mp4'],
        buildId: randomUUID(),
        logger: ctx.logger,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(errors.SystemError);
    expect(thrownError).toMatchObject({
      errorCode: errors.ErrorCode.SERVER_ERROR,
      trackingCode: 'EAS_BUILD_UPLOAD_BUILD_ARTIFACTS_FAILED',
      message: 'Failed to upload build artifacts.',
      buildPhase: undefined,
      metadata: expect.objectContaining({
        filename: expect.stringMatching(/^artifacts-.*\.mp4$/),
        size: expect.any(Number),
        url: uploadUrl,
        headers: {
          authorization: testSignedUploadAuthorization,
        },
      }),
      cause: uploadError,
    });
  });
});

describe('with signed upload url provided via www', () => {
  it('should use www signed upload url', async () => {
    vol.fromJSON({
      './video.mp4': JSON.stringify(randomBytes(20)),
    });
    const buildId = randomUUID();

    // @ts-expect-error
    const ctx: BuildContext<Job> = {
      env: {
        EAS_BUILD_ID: buildId,
      },
      job: {
        platform: 'ios',
        secrets: {
          robotAccessToken: 'fake-token',
        },
      } as Job,
      logger: mockLogger,
    };

    const bucketKey = `test/${randomUUID()}/artifact.ipa`;
    const uploadUrl = `https://upload.url/${randomUUID()}`;
    const testSignedUploadAuthorization = randomUUID();

    turtleFetchMock.mockImplementation(async url => {
      if (url === `https://api.expo.test/v2/turtle-builds/${buildId}/artifacts/`) {
        return {
          ok: true,
          status: 200,
        } as Response;
      } else if (url === `https://api.expo.test/v2/turtle-builds/${buildId}/upload-sessions/`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              bucketKey,
              url: uploadUrl,
              headers: {
                authorization: testSignedUploadAuthorization,
              },
              storageType: 'R2',
            },
          }),
        } as Response;
      } else {
        return {
          ok: false,
          status: 404,
        } as Response;
      }
    });

    await uploadBuildArtifactsAsync(ctx, {
      artifactPaths: ['./video.mp4'],
      buildId: randomUUID(),
      logger: ctx.logger,
    });

    expect(GCS.uploadWithSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        signedUrl: {
          url: uploadUrl,
          headers: {
            authorization: testSignedUploadAuthorization,
          },
        },
      })
    );

    expect(turtleFetchMock).toHaveBeenCalledTimes(2);
    expect(turtleFetchMock).toHaveBeenNthCalledWith(
      1,
      `https://api.expo.test/v2/turtle-builds/${buildId}/upload-sessions/`,
      'POST',
      expect.objectContaining({
        json: {
          filename: expect.any(String),
          name: expect.any(String),
          size: expect.any(Number),
        },
        headers: {
          Authorization: `Bearer ${ctx.job.secrets!.robotAccessToken}`,
        },
        retries: 2,
        retryIntervalMs: 1000,
        logger: ctx.logger,
      })
    );
    expect(turtleFetchMock).toHaveBeenNthCalledWith(
      2,
      `https://api.expo.test/v2/turtle-builds/${buildId}/artifacts/`,
      'POST',
      expect.objectContaining({
        json: { source: { bucketKey, type: 'R2' }, type: 'buildArtifacts' },
        headers: {
          Authorization: `Bearer ${ctx.job.secrets!.robotAccessToken}`,
        },
        retries: 2,
        retryIntervalMs: 1000,
        logger: ctx.logger,
      })
    );
  });
});

describe(uploadWorkflowArtifactAsync.name, () => {
  it('should upload a workflow artifact', async () => {
    vol.fromJSON({
      './video.mp4': JSON.stringify(randomBytes(20)),
    });
    const workflowJobId = randomUUID();
    // @ts-expect-error
    const ctx: BuildContext<Job> = {
      env: {
        __WORKFLOW_JOB_ID: workflowJobId,
      },
      job: {
        secrets: {
          robotAccessToken: 'fake-token',
        },
      } as Job,
      logger: mockLogger,
    };
    const bucketKey = `test/${randomUUID()}/video.mp4`;
    const uploadUrl = `https://upload.url/${randomUUID()}`;
    const testSignedUploadAuthorization = randomUUID();
    const expectedArtifactId = randomUUID();
    turtleFetchMock.mockImplementation(async url => {
      if (url === `https://api.expo.test/v2/workflows/${workflowJobId}/upload-sessions/`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              id: expectedArtifactId,
              bucketKey,
              url: uploadUrl,
              headers: {
                authorization: testSignedUploadAuthorization,
              },
              storageType: 'GCS',
            },
          }),
        } as Response;
      } else {
        return {
          ok: false,
          status: 404,
        } as Response;
      }
    });
    const { artifactId } = await uploadWorkflowArtifactAsync(ctx, {
      artifactPaths: ['./video.mp4'],
      name: 'maestro-video',
      logger: ctx.logger,
    });
    expect(artifactId).toBe(expectedArtifactId);
    expect(GCS.uploadWithSignedUrl).toHaveBeenCalledTimes(1);
    expect(GCS.uploadWithSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        signedUrl: {
          url: uploadUrl,
          headers: {
            authorization: testSignedUploadAuthorization,
          },
        },
      })
    );
    expect(turtleFetchMock).toHaveBeenCalledTimes(1);
    expect(turtleFetchMock).toHaveBeenNthCalledWith(
      1,
      `https://api.expo.test/v2/workflows/${workflowJobId}/upload-sessions/`,
      'POST',
      expect.objectContaining({
        json: { filename: 'video.mp4', name: 'maestro-video', size: expect.any(Number) },
        headers: {
          Authorization: `Bearer ${ctx.job.secrets!.robotAccessToken}`,
        },
        retries: 2,
        retryIntervalMs: 1000,
        logger: ctx.logger,
      })
    );
  });
});
