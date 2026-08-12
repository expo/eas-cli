import { BuildJob, ManagedArtifactType, Platform, SystemError } from '@expo/eas-build-job';
import fg from 'fast-glob';
import fs from 'fs-extra';
import path from 'path';

import { BuildContext } from '../context';

const ANDROID_SOURCE_MAP_PATTERN = 'android/**/build/generated/sourcemaps/react/**/*.map';
const SOURCE_MAP_UPLOAD_DIRECTORY = 'observe-source-maps';

export function isSourceMapUploadEnabled(ctx: BuildContext<BuildJob>): boolean {
  return !ctx.isLocal && ctx.job.experimental?.uploadSourceMaps === true;
}

export async function resolveIosSourceMapPathAsync(ctx: BuildContext<BuildJob>): Promise<string> {
  const configuredPath = ctx.env.SOURCEMAP_FILE;
  const sourceMapPath = configuredPath
    ? path.resolve(ctx.getReactNativeProjectDirectory(), 'ios', configuredPath)
    : path.join(ctx.workingdir, SOURCE_MAP_UPLOAD_DIRECTORY, 'main.jsbundle.map');

  await fs.ensureDir(path.dirname(sourceMapPath));
  return sourceMapPath;
}

export async function maybeUploadSourceMapAsync(ctx: BuildContext<BuildJob>): Promise<void> {
  if (!isSourceMapUploadEnabled(ctx)) {
    return;
  }

  try {
    const sourceMapPath = await resolveSourceMapPathAsync(ctx);
    const strippedSourceMapPath = await stripSourcesContentAsync(ctx, sourceMapPath);

    ctx.logger.info(`Uploading source map: ${sourceMapPath}`);
    await ctx.uploadArtifact({
      artifact: {
        type: ManagedArtifactType.SOURCE_MAP,
        paths: [strippedSourceMapPath],
      },
      logger: ctx.logger,
    });
  } catch (err: any) {
    ctx.logger.warn({ err }, 'Failed to upload source map.');
    ctx.markBuildPhaseHasWarnings();
  }
}

async function resolveSourceMapPathAsync(ctx: BuildContext<BuildJob>): Promise<string> {
  if (ctx.job.platform === Platform.IOS) {
    const sourceMapPath = await resolveIosSourceMapPathAsync(ctx);
    if (!(await fs.pathExists(sourceMapPath))) {
      throw new SystemError(`The iOS source map was not generated at ${sourceMapPath}.`);
    }
    return sourceMapPath;
  }

  if (ctx.job.platform === Platform.ANDROID) {
    const projectDir = ctx.getReactNativeProjectDirectory();
    const sourceMapPaths = (
      await fg(ANDROID_SOURCE_MAP_PATTERN, {
        absolute: true,
        cwd: projectDir,
        onlyFiles: true,
      })
    ).filter(sourceMapPath => !isIntermediateAndroidSourceMap(sourceMapPath));

    if (sourceMapPaths.length === 0) {
      throw new SystemError('The Android build did not generate a final composed source map.');
    }
    if (sourceMapPaths.length > 1) {
      throw new SystemError(
        `Found multiple final Android source maps: ${sourceMapPaths.join(', ')}. ` +
          'Refusing to upload a source map that may not match the application archive.'
      );
    }
    return sourceMapPaths[0];
  }

  throw new SystemError('Source-map upload is not supported for this build platform.');
}

function isIntermediateAndroidSourceMap(sourceMapPath: string): boolean {
  return sourceMapPath.endsWith('.packager.map') || sourceMapPath.endsWith('.compiler.map');
}

async function stripSourcesContentAsync(
  ctx: BuildContext<BuildJob>,
  sourceMapPath: string
): Promise<string> {
  const sourceMap = JSON.parse(await fs.readFile(sourceMapPath, 'utf8')) as unknown;
  if (!isRecord(sourceMap) || sourceMap.version !== 3) {
    throw new SystemError(`Invalid source map at ${sourceMapPath}.`);
  }

  removeSourcesContent(sourceMap);

  const uploadDirectory = path.join(ctx.workingdir, SOURCE_MAP_UPLOAD_DIRECTORY);
  const uploadPath = path.join(uploadDirectory, `${ctx.job.platform}.map`);
  await fs.ensureDir(uploadDirectory);
  await fs.writeFile(uploadPath, JSON.stringify(sourceMap), 'utf8');
  return uploadPath;
}

function removeSourcesContent(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      removeSourcesContent(child);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  delete value.sourcesContent;
  for (const child of Object.values(value)) {
    removeSourcesContent(child);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
