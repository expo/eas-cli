import { randomBytes, randomUUID } from 'crypto';

import { BuildContext, GCS } from '@expo/build-tools';
import { vol } from 'memfs';
import { Job } from '@expo/eas-build-job';
import { Response } from 'node-fetch';
import { turtleFetch } from '@expo/turtle-common';

import {
  uploadApplicationArchiveAsync,
  uploadBuildArtifactsAsync,
  uploadWorkflowArtifactAsync,
} from '../upload';
import config from '../config';

jest.mock('fs');
jest.mock('fs/promises');
jest.mock('@expo/turtle-common', () => ({
  ...jest.requireActual('@expo/turtle-common'),
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
    ).rejects.toThrow('env variables are not set');

    ctx.env.__WORKFLOW_JOB_ID = randomUUID();

    await expect(
      uploadApplicationArchiveAsync(ctx, {
        artifactPaths: ['./artifact.ipa'],
        buildId: 'buildId',
        logger: ctx.logger,
      })
    ).rejects.toThrow('robot access token is not set');
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
      })
    );
  });

  describe('with signed upload url provided via config', () => {
    beforeAll(() => {
      config.gcsSignedUploadUrlForApplicationArchive = {
        url: 'https://upload.url/from-config',
        headers: {
          authorization: 'test-signed-upload-authorization',
        },
      };
    });
    afterAll(() => {
      config.gcsSignedUploadUrlForApplicationArchive = null;
    });

    it('should fall back to signed upload URL if upload session fails', async () => {
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
      };

      turtleFetchMock.mockImplementation(async () => {
        return {
          json: async () => ({
            data: {
              bucketKey: 'test/bucketKey',
              url: 'https://upload.url/from-www',
              headers: {
                authorization: 'test-signed-upload-authorization',
              },
              storageType: 'GCS',
            },
          }),
          ok: true,
        } as unknown as Response;
      });

      // GCS fails to upload to upload session from www.
      jest.mocked(GCS.uploadWithSignedUrl).mockImplementation(async ({ signedUrl }) => {
        if (signedUrl.url === 'https://upload.url/from-www') {
          throw new Error('upload failed');
        }
        return signedUrl.url;
      });

      await uploadApplicationArchiveAsync(ctx, {
        artifactPaths: ['./artifact.ipa'],
        buildId: randomUUID(),
        logger: ctx.logger,
      });

      expect(GCS.uploadWithSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          signedUrl: {
            url: 'https://upload.url/from-config',
            headers: {
              authorization: 'test-signed-upload-authorization',
            },
          },
        })
      );

      expect(turtleFetchMock).toHaveBeenCalledTimes(1);
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
    ).rejects.toThrow('env variables are not set');
    ctx.env.__WORKFLOW_JOB_ID = randomUUID();
    await expect(
      uploadBuildArtifactsAsync(ctx, {
        artifactPaths: ['./video.mp4'],
        buildId: 'buildId',
        logger: ctx.logger,
      })
    ).rejects.toThrow('robot access token is not set');
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
      })
    );
  });

  describe('with signed upload url provided via config', () => {
    beforeAll(() => {
      config.gcsSignedUploadUrlForBuildArtifacts = {
        url: 'https://upload.url/from-config',
        headers: {
          authorization: 'test-signed-upload-authorization',
        },
      };
    });
    afterAll(() => {
      config.gcsSignedUploadUrlForBuildArtifacts = null;
    });

    it('should fall back to signed upload URL if upload session fails', async () => {
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
      };

      turtleFetchMock.mockImplementation(async () => {
        return {
          json: async () => ({
            data: {
              bucketKey: 'test/bucketKey',
              url: 'https://upload.url/from-www',
              headers: {
                authorization: 'test-signed-upload-authorization',
              },
              storageType: 'GCS',
            },
          }),
          ok: true,
        } as unknown as Response;
      });

      // GCS fails to upload to upload session from www.
      jest.mocked(GCS.uploadWithSignedUrl).mockImplementation(async ({ signedUrl }) => {
        if (signedUrl.url === 'https://upload.url/from-www') {
          throw new Error('upload failed');
        }
        return signedUrl.url;
      });

      await uploadBuildArtifactsAsync(ctx, {
        artifactPaths: ['./video.mp4'],
        buildId: randomUUID(),
        logger: ctx.logger,
      });

      expect(GCS.uploadWithSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          signedUrl: {
            url: 'https://upload.url/from-config',
            headers: {
              authorization: 'test-signed-upload-authorization',
            },
          },
        })
      );

      expect(turtleFetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe('with signed upload url provided via www', () => {
  beforeAll(() => {
    config.gcsSignedUploadUrlForBuildArtifacts = null;
  });
  afterAll(() => {
    config.gcsSignedUploadUrlForBuildArtifacts = null;
  });

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
      })
    );
  });
});
