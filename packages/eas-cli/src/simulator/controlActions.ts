import * as fs from 'fs-extra';
import path from 'path';

import { createAppArchiveAsync } from './appArchive';
import {
  HostActionCatalog,
  HostActionCatalogEntry,
  HostActionConnection,
  assertHostActionOutputAsync,
  saveHostActionOutputAsync,
  uploadFileAsync,
} from './hostActions';

export type ControlAction = {
  action: string;
  params: Record<string, unknown>;
  outputPath?: string;
  file?: string;
};

export type ControlActionResult = { output: string; file: string | null };

export type PreparedControlAction = Readonly<{
  action: string;
  entry: HostActionCatalogEntry;
  params: Readonly<Record<string, unknown>>;
  outputPath?: string;
  localFile?: Readonly<{ param: string; path: string; appBundle?: true }>;
}>;

export function resolveControlActionPath(value: string, baseDir?: string): string {
  if (!baseDir) {
    return value;
  }
  const resolved = path.resolve(baseDir, value);
  return value.endsWith('/') || value.endsWith(path.sep) ? `${resolved}${path.sep}` : resolved;
}

export async function prepareControlActionAsync(
  catalog: HostActionCatalog,
  action: ControlAction,
  {
    localFileMode = 'auto',
    baseDir,
  }: { localFileMode?: 'auto' | 'explicit'; baseDir?: string } = {}
): Promise<PreparedControlAction> {
  const entry = Object.hasOwn(catalog, action.action) ? catalog[action.action] : undefined;
  if (!entry) {
    throw new Error(
      `Unknown simulator action "${action.action}". Run \`eas simulator:control --list\` to see the actions.`
    );
  }
  const params = { ...action.params };
  const outputPath = action.outputPath
    ? resolveControlActionPath(action.outputPath, baseDir)
    : action.outputPath;
  await assertHostActionOutputAsync(action.action, entry, outputPath);

  let localFile: PreparedControlAction['localFile'];
  const param = entry.upload;
  const applies = Object.entries(entry.uploadWhen ?? {}).every(
    ([name, expected]) => params[name] === expected
  );
  if (action.file !== undefined) {
    if (!param || !applies) {
      throw new Error(`${action.action} does not accept a local file with these parameters.`);
    }
    if (Object.hasOwn(params, param)) {
      throw new Error(`${param} and file cannot both be supplied for ${action.action}.`);
    }
    localFile = await prepareLocalFileAsync(
      action.action,
      entry,
      resolveControlActionPath(action.file, baseDir)
    );
  } else if (localFileMode === 'auto' && param && applies && typeof params[param] === 'string') {
    const value = params[param];
    if (value.startsWith('host:')) {
      if (entry.uploadAs === 'id') {
        throw new Error(
          'This action requires a local file to upload; host: paths are not supported.'
        );
      }
      const hostPath = value.slice('host:'.length);
      if (!path.posix.isAbsolute(hostPath)) {
        throw new Error(
          `A host: path must be absolute, for example host:/tmp/app.tar.gz. For a local filename beginning with host:, use ./${value}.`
        );
      }
      params[param] = hostPath;
    } else {
      const localPath = resolveControlActionPath(value, baseDir);
      const stat = await fs.stat(localPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
          return null;
        }
        throw error;
      });
      if (!stat) {
        throw new Error(
          `${value} does not exist on this computer. Pass a local file, or prefix an absolute simulator-host path with host:.`
        );
      }
      localFile = await prepareLocalFileAsync(action.action, entry, localPath, stat);
    }
  }
  return {
    action: action.action,
    entry,
    params,
    outputPath,
    ...(localFile ? { localFile } : {}),
  };
}

async function prepareLocalFileAsync(
  action: string,
  entry: HostActionCatalogEntry,
  localPath: string,
  stats?: fs.Stats
): Promise<NonNullable<PreparedControlAction['localFile']>> {
  const stat = await assertLocalFileAsync(localPath, { action, stats });
  if (
    action === 'app.install' &&
    (stat.isDirectory() || /\.(?:tar\.gz|tgz)$/i.test(localPath)) &&
    entry.uploadArchive !== 'tar.gz'
  ) {
    throw new Error(
      'This simulator host does not support app archives. Start a session with an updated serve-sim package.'
    );
  }
  return {
    param: entry.upload!,
    path: localPath,
    ...(stat.isDirectory() ? { appBundle: true } : {}),
  };
}

export async function assertLocalFileAsync(
  localPath: string,
  { action, stats }: { action?: string; stats?: fs.Stats } = {}
): Promise<fs.Stats> {
  const stat = stats ?? (await fs.stat(localPath).catch(() => null));
  if (!stat) {
    throw new Error(`${localPath} does not exist on this computer.`);
  }
  if (stat.isDirectory()) {
    if (action !== 'app.install') {
      throw new Error(`${localPath} is a folder. Pass the path of a file.`);
    }
    if (path.extname(path.resolve(localPath)) !== '.app') {
      throw new Error(
        `${localPath} is a folder. Pass a Simulator .app bundle or .tar.gz/.tgz archive.`
      );
    }
  } else if (!stat.isFile()) {
    throw new Error(`${localPath} is not a regular file.`);
  } else if (action === 'app.install' && /\.(?:ipa|zip)$/i.test(localPath)) {
    throw new Error(
      'Simulator installs require a Simulator .app bundle or .tar.gz/.tgz archive. Device .ipa builds and .zip archives are not supported.'
    );
  } else if (stat.size === 0) {
    throw new Error(`${localPath} is empty. Pass a file with content.`);
  }
  await fs.access(localPath, fs.constants.R_OK);
  return stat;
}

export async function executeControlActionAsync(
  connection: HostActionConnection,
  plan: PreparedControlAction,
  {
    validateParams,
    onProgress,
    handleInterrupt,
  }: {
    validateParams?: (params: Record<string, unknown>) => void;
    onProgress?: (phase: 'packaging' | 'uploading' | 'running') => void;
    handleInterrupt?: boolean;
  } = {}
): Promise<ControlActionResult> {
  connection.signal.throwIfAborted();
  const params: Record<string, unknown> = { ...plan.params };
  let uploadId: string | undefined;
  let archive: Awaited<ReturnType<typeof createAppArchiveAsync>> | undefined;
  let succeeded = false;
  try {
    if (plan.localFile) {
      if (plan.localFile.appBundle) {
        onProgress?.('packaging');
        archive = await createAppArchiveAsync(plan.localFile.path, { handleInterrupt });
      }
      connection.signal.throwIfAborted();
      onProgress?.('uploading');
      const upload = await uploadFileAsync(connection, archive?.path ?? plan.localFile.path);
      uploadId = upload.uploadId;
      params[plan.localFile.param] = plan.entry.uploadAs === 'id' ? upload.uploadId : upload.path;
    }
    connection.signal.throwIfAborted();
    validateParams?.(params);
    onProgress?.('running');
    const result = await connection.requestAsync(plan.action, params);
    if (result.exitCode !== 0) {
      const detail = (result.stderr || result.stdout).trim() || `exit code ${result.exitCode}`;
      throw new Error(`The simulator could not run ${plan.action}: ${detail}`);
    }
    succeeded = true;
    const file = await saveHostActionOutputAsync(
      connection,
      plan.entry,
      result.stdout,
      plan.outputPath
    );
    return { output: file ? '' : result.stdout.trim(), file };
  } finally {
    if (uploadId && (!plan.entry.keepUpload || !succeeded)) {
      await connection.requestAsync('upload.remove', { uploadId }).catch(() => {});
    }
    await archive?.cleanupAsync();
  }
}

export function parseControlActionOutput(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}
