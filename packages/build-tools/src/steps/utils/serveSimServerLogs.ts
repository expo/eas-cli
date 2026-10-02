import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CircularFile, SERVE_SIM_LOG_MAX_BYTES } from './circularFile';

export type ServeSimServerLog = {
  directory: string;
  filePath: string;
  secrets: string[];
  output: CircularFile;
};

const sessionLogs = new Map<string, ServeSimServerLog[]>();

export async function createServeSimServerLogAsync(
  deviceRunSessionId: string,
  secrets: string[]
): Promise<ServeSimServerLog> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-server-log-'));
  const filePath = path.join(directory, 'serve-sim.log');
  let output: CircularFile;
  try {
    output = new CircularFile(filePath);
  } catch (err) {
    await rm(directory, { recursive: true, force: true });
    throw err;
  }
  const log = { directory, filePath, secrets, output };
  const logs = sessionLogs.get(deviceRunSessionId) ?? [];
  logs.push(log);
  sessionLogs.set(deviceRunSessionId, logs);
  return log;
}

export function takeServeSimServerLogs(deviceRunSessionId: string): ServeSimServerLog[] {
  const logs = sessionLogs.get(deviceRunSessionId) ?? [];
  sessionLogs.delete(deviceRunSessionId);
  return logs;
}

export async function prepareServeSimServerLogAsync(
  log: ServeSimServerLog
): Promise<{ filePath: string; size: number; truncated: boolean }> {
  let text = log.output.read().toString('utf8');
  let truncated = log.output.truncated;
  for (const secret of log.secrets.filter(Boolean)) {
    text = text
      .replaceAll(secret, '[REDACTED]')
      .replaceAll(encodeURIComponent(secret), '[REDACTED]');
  }
  text = text
    .replace(/([?&]token=)[^\s&#"'<>]+/gi, '$1[REDACTED]')
    .replace(/("(?:token|credential)"\s*:\s*")[^"\r\n]*(")/gi, '$1[REDACTED]$2')
    .replace(/(Bearer\s+)[^\s"'<>]+/gi, '$1[REDACTED]');
  const marker = '[Earlier output omitted; retaining the last 10 MiB.]\n';
  const bytes = Buffer.from(text);
  if (truncated || bytes.length > SERVE_SIM_LOG_MAX_BYTES) {
    truncated = true;
    let start = Math.max(0, bytes.length - SERVE_SIM_LOG_MAX_BYTES + Buffer.byteLength(marker));
    while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
      start++;
    }
    text = bytes.subarray(start).toString('utf8');
    const newline = text.indexOf('\n');
    text = marker + (newline >= 0 && newline + 1 < text.length ? text.slice(newline + 1) : text);
  }
  const filePath = path.join(log.directory, 'serve-sim-upload.log');
  await writeFile(filePath, text, { mode: 0o600 });
  return { filePath, size: Buffer.byteLength(text), truncated };
}
