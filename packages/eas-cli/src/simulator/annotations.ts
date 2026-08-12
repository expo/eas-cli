import { randomUUID } from 'crypto';
import fs from 'fs-extra';
import path from 'path';

import fetch, { RequestError } from '../fetch';
import { getDataDirectory } from '../utils/paths';

export const DEVICE_RUN_SESSION_ANNOTATION_CATEGORIES = [
  'commentary',
  'intent',
  'observation',
  'decision',
  'result',
] as const;
export type DeviceRunSessionAnnotationCategory =
  (typeof DEVICE_RUN_SESSION_ANNOTATION_CATEGORIES)[number];

export const MAX_DEVICE_RUN_SESSION_ANNOTATION_MESSAGE_LENGTH = 2_000;
export const MAX_DEVICE_RUN_SESSION_ANNOTATION_COUNT = 500;
export const MAX_DEVICE_RUN_SESSION_ANNOTATION_LOG_SIZE_BYTES = 5 * 1024 * 1024;

const ANNOTATION_FILE_NAME = 'annotations.ndjson';
const LOCK_FILE_NAME = 'annotations.lock';
const LOCK_RETRY_INTERVAL_MS = 50;
const LOCK_WAIT_TIMEOUT_MS = 10_000;
const STALE_LOCK_AGE_MS = 2 * 60_000;

export type DeviceRunSessionAnnotation = {
  v: 1;
  annotationId: string;
  ts: string;
  category: DeviceRunSessionAnnotationCategory;
  message: string;
};

export type DeviceRunSessionAnnotationUploadSession = {
  downloadUrl: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
};

export class DeviceRunSessionAnnotationUploadError extends Error {
  constructor(
    public readonly filePath: string,
    cause: unknown
  ) {
    super('Could not upload the simulator session annotation log.', { cause });
  }
}

export function createDeviceRunSessionAnnotation({
  category,
  message,
  annotationId = randomUUID(),
  timestamp = new Date(),
}: {
  category: DeviceRunSessionAnnotationCategory;
  message: string;
  annotationId?: string;
  timestamp?: Date;
}): DeviceRunSessionAnnotation {
  const normalizedMessage = message.trim();
  if (normalizedMessage.length === 0) {
    throw new Error('Annotation message must not be empty.');
  }
  if (normalizedMessage.length > MAX_DEVICE_RUN_SESSION_ANNOTATION_MESSAGE_LENGTH) {
    throw new Error(
      `Annotation message must not exceed ${MAX_DEVICE_RUN_SESSION_ANNOTATION_MESSAGE_LENGTH} characters.`
    );
  }

  return {
    v: 1,
    annotationId,
    ts: timestamp.toISOString(),
    category,
    message: normalizedMessage,
  };
}

/**
 * Maintains a durable local spool and replaces the remote object after each append.
 * The local lock supports concurrent commands on one machine; remote replacement assumes a
 * single active writer for a session, with sequential handoff supported by downloading the log.
 */
export async function appendAndUploadDeviceRunSessionAnnotationAsync({
  annotation,
  deviceRunSessionId,
  uploadSession,
  dataDirectory = getDataDirectory(),
}: {
  annotation: DeviceRunSessionAnnotation;
  deviceRunSessionId: string;
  uploadSession: DeviceRunSessionAnnotationUploadSession;
  dataDirectory?: string;
}): Promise<{ filePath: string; fileSizeBytes: number }> {
  const sessionDirectory = getDeviceRunSessionAnnotationDirectory(
    dataDirectory,
    deviceRunSessionId
  );
  await fs.ensureDir(sessionDirectory);

  return await withAnnotationFileLockAsync(sessionDirectory, async () => {
    const filePath = path.join(sessionDirectory, ANNOTATION_FILE_NAME);
    if (!(await fs.pathExists(filePath))) {
      await initializeAnnotationFileAsync(filePath, uploadSession.downloadUrl);
    }

    const currentContents = await fs.readFile(filePath, 'utf8');
    const annotationCount = currentContents.split('\n').filter(line => line.trim()).length;
    if (annotationCount >= MAX_DEVICE_RUN_SESSION_ANNOTATION_COUNT) {
      throw new Error(
        `Simulator sessions support at most ${MAX_DEVICE_RUN_SESSION_ANNOTATION_COUNT} annotations.`
      );
    }

    const separator = currentContents.length > 0 && !currentContents.endsWith('\n') ? '\n' : '';
    const appendedContents = `${currentContents}${separator}${JSON.stringify(annotation)}\n`;
    const fileSizeBytes = Buffer.byteLength(appendedContents);
    if (fileSizeBytes > MAX_DEVICE_RUN_SESSION_ANNOTATION_LOG_SIZE_BYTES) {
      throw new Error('Simulator session annotation log exceeds the 5 MiB limit.');
    }

    await fs.writeFile(filePath, appendedContents, { mode: 0o600 });
    try {
      await uploadAnnotationFileAsync(filePath, uploadSession);
    } catch (error) {
      throw new DeviceRunSessionAnnotationUploadError(filePath, error);
    }
    return { filePath, fileSizeBytes };
  });
}

export function getDeviceRunSessionAnnotationDirectory(
  dataDirectory: string,
  deviceRunSessionId: string
): string {
  return path.join(dataDirectory, 'simulator-sessions', deviceRunSessionId);
}

async function initializeAnnotationFileAsync(filePath: string, downloadUrl: string): Promise<void> {
  let contents = '';
  try {
    const response = await fetch(downloadUrl);
    const downloaded = await response.buffer();
    if (downloaded.byteLength > MAX_DEVICE_RUN_SESSION_ANNOTATION_LOG_SIZE_BYTES) {
      throw new Error('Existing simulator session annotation log exceeds the 5 MiB limit.');
    }
    contents = downloaded.toString('utf8');
  } catch (error) {
    if (!(error instanceof RequestError && error.response.status === 404)) {
      throw error;
    }
  }

  await fs.writeFile(filePath, contents, { flag: 'wx', mode: 0o600 });
}

async function uploadAnnotationFileAsync(
  filePath: string,
  uploadSession: DeviceRunSessionAnnotationUploadSession
): Promise<void> {
  const body = await fs.readFile(filePath);
  await fetch(uploadSession.uploadUrl, {
    method: 'PUT',
    headers: uploadSession.uploadHeaders,
    body,
  });
}

async function withAnnotationFileLockAsync<T>(
  sessionDirectory: string,
  callback: () => Promise<T>
): Promise<T> {
  const lockPath = path.join(sessionDirectory, LOCK_FILE_NAME);
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  let fileDescriptor: number | undefined;

  while (fileDescriptor === undefined) {
    try {
      fileDescriptor = await fs.open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (!isErrorWithCode(error, 'EEXIST')) {
        throw error;
      }

      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > STALE_LOCK_AGE_MS) {
        await fs.remove(lockPath);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for another annotation upload to finish.');
      }
      await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));
    }
  }

  try {
    return await callback();
  } finally {
    await fs.close(fileDescriptor);
    await fs.remove(lockPath);
  }
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
