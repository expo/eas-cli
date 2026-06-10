import { bunyan } from '@expo/logger';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { turtleFetch } from '../../utils/turtleFetch';

/**
 * agent-device's remote client rewrites media output paths to predictable
 * temp paths before sending the RPC to the daemon:
 * - screenshots -> /tmp/agent-device-screenshot-<ts>-<rand>.png
 * - recordings  -> /tmp/agent-device-recording-<ts>-<rand>.<ext>
 * The daemon deletes those files shortly after the remote client downloads
 * them, so we hardlink them into our own artifacts directory as they appear
 * (a hardlink shares the inode, so it survives the daemon's delete and its
 * content converges to the final bytes even when linked mid-write).
 *
 * These path patterns are agent-device internals, not an API. If they change
 * upstream, collection degrades to "no artifacts" - it must never break the
 * session, so everything in this module is best-effort and never throws.
 */
const AGENT_DEVICE_MEDIA_FILE_PATTERN = /^agent-device-(screenshot|recording)-/;

const COLLECTOR_POLL_INTERVAL_MS = 500;
const DEFAULT_WATCH_DIR = '/tmp';

const AGENT_DEVICE_SESSIONS_DIR = path.join(os.homedir(), '.agent-device', 'sessions');
const DEFAULT_AGENT_DEVICE_SESSION_NAME = 'default';

const STOP_RECORDINGS_TOTAL_BUDGET_MS = 60_000;
const STOP_RECORDINGS_PER_REQUEST_TIMEOUT_MS = 30_000;

export function isAgentDeviceMediaFileName(fileName: string): boolean {
  // Dot-prefixed files are agent-device post-processing temp files - the
  // final file is renamed over the original path, which our hardlink of the
  // original already points at (possibly the raw variant; the abort handler
  // additionally copies the final processed file from the record-stop RPC
  // response).
  return !fileName.startsWith('.') && AGENT_DEVICE_MEDIA_FILE_PATTERN.test(fileName);
}

export interface AgentDeviceMediaCollector {
  /** Runs a full scan of the watch directory and waits for it to finish. */
  sweepAsync: () => Promise<void>;
  stop: () => void;
}

/**
 * Watches `watchDir` (fs.watch + initial scan + polling sweep fallback) for
 * agent-device media files and hardlinks each match into `artifactsDir`.
 * Entirely best-effort: never throws, logs at debug/warn level only.
 */
export function startAgentDeviceMediaCollector({
  artifactsDir,
  logger,
  watchDir = DEFAULT_WATCH_DIR,
}: {
  artifactsDir: string;
  logger: bunyan;
  watchDir?: string;
}): AgentDeviceMediaCollector {
  let stopped = false;

  const collectFileAsync = async (fileName: string): Promise<void> => {
    const sourcePath = path.join(watchDir, fileName);
    const targetPath = path.join(artifactsDir, fileName);
    try {
      await fs.promises.link(sourcePath, targetPath);
      logger.debug(`Collected agent-device media file ${fileName}.`);
    } catch (err: any) {
      if (err?.code === 'EEXIST') {
        // Already collected.
        return;
      }
      if (err?.code === 'ENOENT') {
        // The file disappeared between detection and linking.
        return;
      }
      // Hardlink failed (e.g. EXDEV when artifactsDir is on another device) -
      // fall back to a copy.
      try {
        await fs.promises.copyFile(sourcePath, targetPath);
        logger.debug(`Copied agent-device media file ${fileName} (hardlink failed).`);
      } catch (copyErr: any) {
        if (copyErr?.code !== 'ENOENT') {
          logger.debug({ err: copyErr }, `Failed to collect agent-device media file ${fileName}.`);
        }
      }
    }
  };

  const sweepAsync = async (): Promise<void> => {
    try {
      const fileNames = await fs.promises.readdir(watchDir);
      await Promise.all(
        fileNames.filter(fileName => isAgentDeviceMediaFileName(fileName)).map(collectFileAsync)
      );
    } catch (err) {
      logger.debug({ err }, `Failed to sweep ${watchDir} for agent-device media files.`);
    }
  };

  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(watchDir, (_eventType, fileName) => {
      if (stopped || typeof fileName !== 'string' || !isAgentDeviceMediaFileName(fileName)) {
        return;
      }
      void collectFileAsync(fileName);
    });
    watcher.on('error', err => {
      logger.debug({ err }, `agent-device media watcher on ${watchDir} errored.`);
    });
  } catch (err) {
    // Polling sweeps still cover us.
    logger.warn(
      { err },
      `Failed to watch ${watchDir} for agent-device media files - relying on polling sweeps only.`
    );
  }

  // Initial scan for files created before the collector started.
  void sweepAsync();

  // Polling sweep fallback for events missed by fs.watch.
  const pollInterval = setInterval(() => {
    void sweepAsync();
  }, COLLECTOR_POLL_INTERVAL_MS);
  pollInterval.unref();

  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(pollInterval);
    try {
      watcher?.close();
    } catch {
      // Best-effort.
    }
  };

  return { sweepAsync, stop };
}

/**
 * Best-effort finalization of in-flight recordings: enumerates daemon
 * sessions from the on-disk state directory (plus the default session) and
 * issues a `record stop` to each one via the daemon's local JSON-RPC
 * endpoint. Files referenced by successful responses (the final processed
 * videos) are copied into `artifactsDir`, overwriting any same-named
 * hardlinked raw variant. Never throws.
 */
export async function stopActiveAgentDeviceRecordingsAsync({
  daemonPort,
  daemonToken,
  artifactsDir,
  logger,
  sessionsDir = AGENT_DEVICE_SESSIONS_DIR,
  budgetMs = STOP_RECORDINGS_TOTAL_BUDGET_MS,
}: {
  daemonPort: number;
  daemonToken: string;
  artifactsDir: string;
  logger: bunyan;
  sessionsDir?: string;
  budgetMs?: number;
}): Promise<void> {
  const deadline = Date.now() + budgetMs;
  const sessionNames = await enumerateAgentDeviceSessionNamesAsync({ sessionsDir, logger });

  for (const sessionName of sessionNames) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      logger.warn(`Ran out of time finalizing in-flight recordings - skipping remaining sessions.`);
      return;
    }
    await stopRecordingForSessionAsync({
      daemonPort,
      daemonToken,
      sessionName,
      artifactsDir,
      logger,
      timeoutMs: Math.min(STOP_RECORDINGS_PER_REQUEST_TIMEOUT_MS, remainingMs),
    });
  }
}

async function enumerateAgentDeviceSessionNamesAsync({
  sessionsDir,
  logger,
}: {
  sessionsDir: string;
  logger: bunyan;
}): Promise<string[]> {
  const sessionNames = new Set<string>();
  try {
    const entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      // Session state lives in subdirectories; sibling files (e.g.
      // <session>.trace.log) are not sessions.
      if (entry.isDirectory()) {
        sessionNames.add(entry.name);
      }
    }
  } catch (err) {
    logger.debug({ err }, `Failed to enumerate agent-device sessions in ${sessionsDir}.`);
  }
  // Always try the default session, even when no session directories exist.
  sessionNames.add(DEFAULT_AGENT_DEVICE_SESSION_NAME);
  return [...sessionNames];
}

async function stopRecordingForSessionAsync({
  daemonPort,
  daemonToken,
  sessionName,
  artifactsDir,
  logger,
  timeoutMs,
}: {
  daemonPort: number;
  daemonToken: string;
  sessionName: string;
  artifactsDir: string;
  logger: bunyan;
  timeoutMs: number;
}): Promise<void> {
  try {
    const response = await turtleFetch(`http://127.0.0.1:${daemonPort}/rpc`, 'POST', {
      json: {
        jsonrpc: '2.0',
        id: `eas-abort-cleanup-${Date.now()}`,
        method: 'agent_device.command',
        params: {
          session: sessionName,
          command: 'record',
          positionals: ['stop'],
        },
      },
      headers: {
        Authorization: `Bearer ${daemonToken}`,
      },
      timeout: timeoutMs,
      retries: 0,
      shouldThrowOnNotOk: false,
    });
    const body = (await response.json()) as {
      result?: { ok?: boolean; data?: { outPath?: unknown; artifacts?: unknown } };
      error?: { message?: string };
    };
    if (body?.error || !body?.result?.ok) {
      // "No active recording" errors are expected for sessions without an
      // in-flight recording.
      logger.debug(
        `record stop for agent-device session "${sessionName}" did not finalize a recording${
          body?.error?.message ? `: ${body.error.message}` : '.'
        }`
      );
      return;
    }
    const artifactPaths = extractArtifactPathsFromRecordStopData(body.result.data);
    for (const artifactPath of artifactPaths) {
      try {
        await fs.promises.copyFile(
          artifactPath,
          path.join(artifactsDir, path.basename(artifactPath))
        );
        logger.info(
          `Collected finalized recording ${path.basename(artifactPath)} from agent-device session "${sessionName}".`
        );
      } catch (err) {
        logger.debug({ err }, `Failed to copy finalized recording ${artifactPath}.`);
      }
    }
  } catch (err) {
    logger.debug({ err }, `record stop for agent-device session "${sessionName}" failed.`);
  }
}

function extractArtifactPathsFromRecordStopData(data: unknown): string[] {
  const paths = new Set<string>();
  if (!data || typeof data !== 'object') {
    return [];
  }
  const { outPath, artifacts } = data as { outPath?: unknown; artifacts?: unknown };
  if (typeof outPath === 'string' && outPath) {
    paths.add(outPath);
  }
  if (Array.isArray(artifacts)) {
    for (const artifact of artifacts) {
      if (
        artifact &&
        typeof artifact === 'object' &&
        typeof (artifact as { path?: unknown }).path === 'string' &&
        (artifact as { path: string }).path
      ) {
        paths.add((artifact as { path: string }).path);
      }
    }
  }
  return [...paths];
}
