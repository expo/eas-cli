import { BuildJob, Ios, ManagedArtifactType } from '@expo/eas-build-job';
import { vol } from 'memfs';

import { createTestAndroidJob, createTestIosJob } from '../../__tests__/utils/job';
import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { maybeUploadDebugSymbolsAsync } from '../debugSymbols';

const ARCHIVE_PATH = '/workingdir/build/ios/build/Remember.app.dSYM.zip';

function enableDebugSymbolsUpload(job: Ios.Job): Ios.Job {
  return {
    ...job,
    experimental: {
      ...job.experimental,
      uploadDebugSymbols: true,
    },
  };
}

function createContext<TJob extends BuildJob>(
  job: TJob,
  {
    env = {},
    uploadArtifact = jest.fn(async () => ({ filename: null })),
  }: { env?: Record<string, string>; uploadArtifact?: jest.Mock } = {}
): { ctx: BuildContext<TJob>; uploadArtifact: jest.Mock } {
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

describe(maybeUploadDebugSymbolsAsync.name, () => {
  it('uploads the dSYM archive that gym wrote', async () => {
    vol.fromJSON({ [ARCHIVE_PATH]: 'zip' });
    const { ctx, uploadArtifact } = createContext(enableDebugSymbolsUpload(createTestIosJob()));

    await maybeUploadDebugSymbolsAsync(ctx);

    expect(uploadArtifact).toHaveBeenCalledWith({
      artifact: {
        type: ManagedArtifactType.DEBUG_SYMBOLS,
        paths: [ARCHIVE_PATH],
      },
      logger: ctx.logger,
    });
  });

  it('does nothing when the upload is disabled', async () => {
    vol.fromJSON({ [ARCHIVE_PATH]: 'zip' });
    const { ctx, uploadArtifact } = createContext(createTestIosJob());

    await maybeUploadDebugSymbolsAsync(ctx);

    expect(uploadArtifact).not.toHaveBeenCalled();
  });

  it('does not upload debug symbols from local builds', async () => {
    vol.fromJSON({ [ARCHIVE_PATH]: 'zip' });
    const { ctx, uploadArtifact } = createContext(enableDebugSymbolsUpload(createTestIosJob()), {
      env: { EAS_BUILD_RUNNER: 'local-build-plugin' },
    });

    await maybeUploadDebugSymbolsAsync(ctx);

    expect(uploadArtifact).not.toHaveBeenCalled();
  });

  it('does not upload debug symbols from Android builds', async () => {
    const job = createTestAndroidJob();
    const { ctx, uploadArtifact } = createContext({
      ...job,
      experimental: { ...job.experimental, uploadDebugSymbols: true },
    } as BuildJob);

    await maybeUploadDebugSymbolsAsync(ctx);

    expect(uploadArtifact).not.toHaveBeenCalled();
  });

  it('skips simulator builds without a warning', async () => {
    const { ctx, uploadArtifact } = createContext({
      ...enableDebugSymbolsUpload(createTestIosJob()),
      simulator: true,
    });
    const markBuildPhaseHasWarnings = jest.spyOn(ctx, 'markBuildPhaseHasWarnings');

    await maybeUploadDebugSymbolsAsync(ctx);

    expect(uploadArtifact).not.toHaveBeenCalled();
    expect(markBuildPhaseHasWarnings).not.toHaveBeenCalled();
  });

  it('warns when the build did not write a dSYM archive', async () => {
    vol.fromJSON({ '/workingdir/build/ios/build/Remember.ipa': 'ipa' });
    const { ctx, uploadArtifact } = createContext(enableDebugSymbolsUpload(createTestIosJob()));
    const markBuildPhaseHasWarnings = jest.spyOn(ctx, 'markBuildPhaseHasWarnings');

    await maybeUploadDebugSymbolsAsync(ctx);

    expect(uploadArtifact).not.toHaveBeenCalled();
    expect(markBuildPhaseHasWarnings).toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('did not generate a dSYM archive')
    );
  });

  it('does not guess when the build wrote several dSYM archives', async () => {
    vol.fromJSON({
      [ARCHIVE_PATH]: 'zip',
      '/workingdir/build/ios/build/Other.app.dSYM.zip': 'zip',
    });
    const { ctx, uploadArtifact } = createContext(enableDebugSymbolsUpload(createTestIosJob()));
    const markBuildPhaseHasWarnings = jest.spyOn(ctx, 'markBuildPhaseHasWarnings');

    await maybeUploadDebugSymbolsAsync(ctx);

    expect(uploadArtifact).not.toHaveBeenCalled();
    expect(markBuildPhaseHasWarnings).toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Found multiple dSYM archives')
    );
  });

  it('turns an upload failure into a warning with its cause', async () => {
    vol.fromJSON({ [ARCHIVE_PATH]: 'zip' });
    const { ctx } = createContext(enableDebugSymbolsUpload(createTestIosJob()), {
      uploadArtifact: jest.fn(async () => {
        throw new Error('This feature is not available on the Free plan.');
      }),
    });
    const markBuildPhaseHasWarnings = jest.spyOn(ctx, 'markBuildPhaseHasWarnings');

    await expect(maybeUploadDebugSymbolsAsync(ctx)).resolves.toBeUndefined();

    expect(markBuildPhaseHasWarnings).toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('This feature is not available on the Free plan.')
    );
  });
});
