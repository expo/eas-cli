import { z } from 'zod';

import { UserError } from './errors';

/**
 * Canonical record format for the activity events emitted during a remote device run (simulator)
 * session. Producers (e.g. the worker and agent-device) write these as NDJSON to the
 * session-events artifact and consumers (e.g. EAS CLI and the website) read them back. Keep this
 * schema in sync across every producer and consumer.
 */
export const DeviceRunSessionEventZ = z
  .object({
    v: z.literal(1),
    eventId: z.string(),
    ts: z.string().refine(ts => !Number.isNaN(new Date(ts).getTime())),
    producer: z.string(),
    type: z.string(),
    operationId: z.string().optional(),
    outcome: z.enum(['success', 'failure']).optional(),
    durationMs: z.number().optional(),
    summary: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type DeviceRunSessionEvent = z.infer<typeof DeviceRunSessionEventZ>;

/**
 * Parse the NDJSON session-events log into canonical event records, de-duplicating by `eventId`
 * and sorting chronologically by `ts`. Malformed or incomplete lines (including records with
 * invalid timestamps) are ignored so that a partially-flushed log is still readable.
 */
export function parseDeviceRunSessionEvents(eventLog: string): DeviceRunSessionEvent[] {
  const events = new Map<string, DeviceRunSessionEvent>();

  for (const line of eventLog.split('\n')) {
    try {
      const result = DeviceRunSessionEventZ.safeParse(JSON.parse(line));
      if (result.success) {
        events.set(result.data.eventId, result.data);
      }
    } catch {
      // Ignore malformed or incomplete records.
    }
  }

  return [...events.values()].sort(
    (left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime()
  );
}

// adb closes the connection for longer shell commands (about 65.5 KB with adb 37 on API 35).
export const ANDROID_SHELL_COMMAND_MAX_BYTES = 65_000;

/**
 * Check Android launch inputs before a session starts. The launch component is only known once the
 * build is installed, so this rejects only commands that are too long without it; the launch itself
 * checks the exact command.
 */
export function validateAndroidLaunchOptions({
  launchArgs = [],
  openUrl,
}: {
  launchArgs?: string[];
  openUrl?: string;
}): void {
  quoteAndroidShellCommand(['am', 'start', ...launchArgs, '-n']);
  if (openUrl) {
    quoteAndroidShellCommand(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', openUrl]);
  }
}

/**
 * `adb shell` joins its arguments with spaces and the device shell parses the result again, so
 * each argument is quoted to reach the command as one literal word.
 */
export function quoteAndroidShellCommand(command: string[]): string[] {
  if (command.some(argument => argument.includes('\0'))) {
    throw new UserError(
      'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      'Android "launch_args" and "open_url" cannot contain NUL characters.'
    );
  }
  const quotedCommand = command.map(quoteAndroidShellArgument);
  if (
    new TextEncoder().encode(quotedCommand.join(' ')).byteLength > ANDROID_SHELL_COMMAND_MAX_BYTES
  ) {
    throw new UserError(
      'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      `The Android launch command is longer than ${ANDROID_SHELL_COMMAND_MAX_BYTES} bytes after shell quoting. Shorten "launch_args" or "open_url".`
    );
  }
  return quotedCommand;
}

function quoteAndroidShellArgument(argument: string): string {
  if (/^[\w@%+=:,./-]+$/.test(argument)) {
    return argument;
  }
  return `'${argument.replaceAll("'", `'\\''`)}'`;
}
