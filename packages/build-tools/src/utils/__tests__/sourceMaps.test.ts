import { BuildJob, ManagedArtifactType } from '@expo/eas-build-job';
import fs from 'fs-extra';
import { vol } from 'memfs';

import { createTestAndroidJob, createTestIosJob } from '../../__tests__/utils/job';
import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { maybeUploadSourceMapAsync, prepareIosSourceMapPathAsync } from '../sourceMaps';

function enableSourceMapUpload<TJob extends BuildJob>(job: TJob): TJob {
  return {
    ...job,
    experimental: {
      ...job.experimental,
      uploadSourceMaps: true,
    },
  };
}

function createContext<TJob extends BuildJob>(
  job: TJob,
  env: Record<string, string> = {}
): { ctx: BuildContext<TJob>; uploadArtifact: jest.Mock } {
  const uploadArtifact = jest.fn(async () => ({ filename: null }));
  const ctx = new BuildContext(job, {
    workingdir: '/workingdir',
    logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
    logger: createMockLogger(),
    env: {
      __API_SERVER_URL: 'http://api.expo.test',
      EAS_BUILD_RUNNER: 'eas-build',
      ...env,
    },
    uploadArtifact,
  });
  return { ctx, uploadArtifact };
}

describe(maybeUploadSourceMapAsync.name, () => {
  it('uploads the final Android source map without sourcesContent', async () => {
    const finalSourceMapPath =
      '/workingdir/build/android/app/build/generated/sourcemaps/react/release/index.android.bundle.map';
    vol.fromJSON({
      [finalSourceMapPath]: JSON.stringify({
        version: 3,
        sources: ['App.tsx'],
        sourcesContent: ['customer source'],
        names: [],
        mappings: '',
        sections: [
          {
            map: {
              version: 3,
              sources: ['nested.ts'],
              sourcesContent: ['nested customer source'],
              names: [],
              mappings: '',
            },
          },
        ],
      }),
      [`${finalSourceMapPath.slice(0, -4)}.packager.map`]: JSON.stringify({ version: 3 }),
      [`${finalSourceMapPath.slice(0, -4)}.compiler.map`]: JSON.stringify({ version: 3 }),
    });
    const { ctx, uploadArtifact } = createContext(enableSourceMapUpload(createTestAndroidJob()));

    await maybeUploadSourceMapAsync(ctx);

    expect(uploadArtifact).toHaveBeenCalledWith({
      artifact: {
        type: ManagedArtifactType.SOURCE_MAP,
        paths: ['/workingdir/observe-source-maps/android.map'],
      },
      logger: ctx.logger,
    });
    const uploadedSourceMap = await fs.readJson('/workingdir/observe-source-maps/android.map');
    expect(uploadedSourceMap).not.toHaveProperty('sourcesContent');
    expect(uploadedSourceMap.sections[0].map).not.toHaveProperty('sourcesContent');
  });

  it('does not guess when an Android build produces multiple final source maps', async () => {
    vol.fromJSON({
      '/workingdir/build/android/app/build/generated/sourcemaps/react/release/one.map':
        JSON.stringify({ version: 3 }),
      '/workingdir/build/android/other/build/generated/sourcemaps/react/release/two.map':
        JSON.stringify({ version: 3 }),
    });
    const { ctx, uploadArtifact } = createContext(enableSourceMapUpload(createTestAndroidJob()));
    const markBuildPhaseHasWarnings = jest.spyOn(ctx, 'markBuildPhaseHasWarnings');

    await expect(maybeUploadSourceMapAsync(ctx)).resolves.toBeUndefined();

    expect(uploadArtifact).not.toHaveBeenCalled();
    expect(markBuildPhaseHasWarnings).toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to upload source map.'
    );
  });

  it('does nothing when source-map upload is disabled', async () => {
    const { ctx, uploadArtifact } = createContext(createTestAndroidJob());

    await maybeUploadSourceMapAsync(ctx);

    expect(uploadArtifact).not.toHaveBeenCalled();
  });

  it('does not upload source maps from local builds', async () => {
    const { ctx, uploadArtifact } = createContext(enableSourceMapUpload(createTestAndroidJob()), {
      EAS_BUILD_RUNNER: 'local-build-plugin',
    });

    await maybeUploadSourceMapAsync(ctx);

    expect(uploadArtifact).not.toHaveBeenCalled();
  });
});

describe(prepareIosSourceMapPathAsync.name, () => {
  it('uses an absolute worker-owned path by default', async () => {
    const { ctx } = createContext(createTestIosJob());

    await expect(prepareIosSourceMapPathAsync(ctx)).resolves.toBe(
      '/workingdir/observe-source-maps/main.jsbundle.map'
    );
  });

  it('preserves a configured path relative to the iOS project', async () => {
    const { ctx } = createContext(createTestIosJob(), {
      SOURCEMAP_FILE: 'build/custom/main.jsbundle.map',
    });

    await expect(prepareIosSourceMapPathAsync(ctx)).resolves.toBe(
      '/workingdir/build/ios/build/custom/main.jsbundle.map'
    );
  });
});
