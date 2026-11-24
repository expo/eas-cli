import { BuildJob, ManagedArtifactType, Platform, SystemError } from '@expo/eas-build-job';
import fg from 'fast-glob';

import { BuildContext } from '../context';

const IOS_DEBUG_SYMBOLS_PATTERN = 'ios/build/*.app.dSYM.zip';

export function isDebugSymbolsUploadEnabled(ctx: BuildContext<BuildJob>): boolean {
  return (
    !ctx.isLocal &&
    ctx.job.platform === Platform.IOS &&
    ctx.job.experimental?.uploadDebugSymbols === true
  );
}

export async function maybeUploadDebugSymbolsAsync(ctx: BuildContext<BuildJob>): Promise<void> {
  if (!isDebugSymbolsUploadEnabled(ctx)) {
    return;
  }
  if (ctx.job.platform === Platform.IOS && ctx.job.simulator) {
    ctx.logger.info('Skipping the debug symbols upload: simulator builds have no dSYM archive.');
    return;
  }

  try {
    const debugSymbolsPath = await findIosDebugSymbolsArchiveAsync(ctx);

    ctx.logger.info(`Uploading debug symbols: ${debugSymbolsPath}`);
    await ctx.uploadArtifact({
      artifact: {
        type: ManagedArtifactType.DEBUG_SYMBOLS,
        paths: [debugSymbolsPath],
      },
      logger: ctx.logger,
    });
  } catch (err: any) {
    ctx.logger.warn(
      { err },
      `Failed to upload debug symbols, so native crashes from this build will not be symbolicated. ${err.message}`
    );
    ctx.markBuildPhaseHasWarnings();
  }
}

async function findIosDebugSymbolsArchiveAsync(ctx: BuildContext<BuildJob>): Promise<string> {
  const archivePaths = await fg(IOS_DEBUG_SYMBOLS_PATTERN, {
    absolute: true,
    cwd: ctx.getReactNativeProjectDirectory(),
    onlyFiles: true,
  });

  if (archivePaths.length === 0) {
    throw new SystemError(
      `The build did not generate a dSYM archive matching ${IOS_DEBUG_SYMBOLS_PATTERN}.`
    );
  }
  if (archivePaths.length > 1) {
    throw new SystemError(
      `Found multiple dSYM archives: ${archivePaths.join(', ')}. ` +
        'Refusing to upload debug symbols that may not match the application archive.'
    );
  }
  return archivePaths[0];
}
