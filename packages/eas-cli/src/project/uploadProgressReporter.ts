import path from 'path';

import Log from '../log';
import { UploadProgress } from '../uploads';
import { formatBytes } from '../utils/files';

const MIN_UPLOAD_MS_BEFORE_REPORTING = 10_000;
const SLOW_UPLOAD_SECONDS_LEFT = 60;
const SLOW_UPLOAD_LOG_INTERVAL_MS = 60_000;
const MAX_ACTIVE_UPLOAD_LINES = 5;

function getBytesPerSecond(progress: UploadProgress): number {
  return progress.uploadedBytes / (progress.elapsedMs / 1000);
}

function getSecondsLeft(progress: UploadProgress): number {
  return (progress.fileSize - progress.uploadedBytes) / getBytesPerSecond(progress);
}

function formatMinutesLeft(progress: UploadProgress): string {
  const minutes = Math.ceil(getSecondsLeft(progress) / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function formatUploadProgress(progress: UploadProgress): string {
  const message =
    `${path.basename(progress.file)}: ${formatBytes(progress.uploadedBytes)} of ${formatBytes(progress.fileSize)}, ` +
    `${formatBytes(getBytesPerSecond(progress))}/s`;
  return getSecondsLeft(progress) > SLOW_UPLOAD_SECONDS_LEFT
    ? `${message}, about ${formatMinutesLeft(progress)} left`
    : message;
}

function isSlowUpload(progress: UploadProgress): boolean {
  return (
    progress.elapsedMs >= MIN_UPLOAD_MS_BEFORE_REPORTING &&
    getSecondsLeft(progress) > SLOW_UPLOAD_SECONDS_LEFT
  );
}

export function createUploadProgressReporter({
  isInteractive,
  onActiveUploadsChanged,
}: {
  isInteractive: boolean;
  onActiveUploadsChanged: (lines: string[]) => void;
}): (progress: UploadProgress) => void {
  const activeUploads = new Map<string, UploadProgress>();
  const lastSlowUploadLogTimes = new Map<string, number>();

  return progress => {
    if (progress.uploadedBytes === 0) {
      lastSlowUploadLogTimes.delete(progress.file);
    }
    if (progress.uploadedBytes >= progress.fileSize) {
      activeUploads.delete(progress.file);
    } else {
      activeUploads.set(progress.file, progress);
    }

    if (isInteractive) {
      const lines = [...activeUploads.values()]
        .filter(upload => upload.elapsedMs >= MIN_UPLOAD_MS_BEFORE_REPORTING)
        .map(formatUploadProgress);
      onActiveUploadsChanged(
        lines.length > MAX_ACTIVE_UPLOAD_LINES
          ? [
              ...lines.slice(0, MAX_ACTIVE_UPLOAD_LINES),
              `and ${lines.length - MAX_ACTIVE_UPLOAD_LINES} more uploads`,
            ]
          : lines
      );
      return;
    }

    if (!isSlowUpload(progress)) {
      return;
    }
    const lastLogTime = lastSlowUploadLogTimes.get(progress.file);
    if (lastLogTime === undefined) {
      Log.warn(
        `Uploading ${path.basename(progress.file)} (${formatBytes(progress.fileSize)}) is slow ` +
          `(${formatBytes(getBytesPerSecond(progress))}/s). It may take about ${formatMinutesLeft(progress)}.`
      );
      lastSlowUploadLogTimes.set(progress.file, Date.now());
    } else if (Date.now() - lastLogTime >= SLOW_UPLOAD_LOG_INTERVAL_MS) {
      Log.log(`Still uploading ${formatUploadProgress(progress)}.`);
      lastSlowUploadLogTimes.set(progress.file, Date.now());
    }
  };
}
