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
 * Allowed `adb shell am start` options and the number of arguments each consumes, based on
 * Android's `Intent.parseCommandArgs` and `ActivityManagerShellCommand.makeIntent`.
 *
 * `-n` is intentionally excluded because EAS appends `-n <package>/<activity>` when launching the
 * application.
 */
const ANDROID_AM_START_OPTION_ARITIES: ReadonlyMap<string, number> = new Map([
  // Intent specification options (Intent.parseCommandArgs)
  ['-a', 1], // <ACTION>
  ['-d', 1], // <DATA_URI>
  ['-t', 1], // <MIME_TYPE>
  ['-i', 1], // <IDENTIFIER>
  ['-c', 1], // <CATEGORY>
  ['-p', 1], // <PACKAGE>
  ['-f', 1], // <FLAGS>

  // Intent extra options (Intent.parseCommandArgs)
  ['-e', 2], // <EXTRA_KEY> <EXTRA_STRING_VALUE>
  ['--es', 2], // <EXTRA_KEY> <EXTRA_STRING_VALUE>
  ['--esn', 1], // <EXTRA_KEY>
  ['--ez', 2], // <EXTRA_KEY> <EXTRA_BOOLEAN_VALUE>
  ['--ei', 2], // <EXTRA_KEY> <EXTRA_INT_VALUE>
  ['--el', 2], // <EXTRA_KEY> <EXTRA_LONG_VALUE>
  ['--ef', 2], // <EXTRA_KEY> <EXTRA_FLOAT_VALUE>
  ['--ed', 2], // <EXTRA_KEY> <EXTRA_DOUBLE_VALUE>
  ['--eu', 2], // <EXTRA_KEY> <EXTRA_URI_VALUE>
  ['--ecn', 2], // <EXTRA_KEY> <EXTRA_COMPONENT_NAME_VALUE>
  ['--eia', 2], // <EXTRA_KEY> <EXTRA_INT_VALUE>[,...]
  ['--eial', 2], // <EXTRA_KEY> <EXTRA_INT_VALUE>[,...]
  ['--ela', 2], // <EXTRA_KEY> <EXTRA_LONG_VALUE>[,...]
  ['--elal', 2], // <EXTRA_KEY> <EXTRA_LONG_VALUE>[,...]
  ['--efa', 2], // <EXTRA_KEY> <EXTRA_FLOAT_VALUE>[,...]
  ['--efal', 2], // <EXTRA_KEY> <EXTRA_FLOAT_VALUE>[,...]
  ['--eda', 2], // <EXTRA_KEY> <EXTRA_DOUBLE_VALUE>[,...]
  ['--edal', 2], // <EXTRA_KEY> <EXTRA_DOUBLE_VALUE>[,...]
  ['--esa', 2], // <EXTRA_KEY> <EXTRA_STRING_VALUE>[,...]
  ['--esal', 2], // <EXTRA_KEY> <EXTRA_STRING_VALUE>[,...]

  // URI permission grant flags (Intent.parseCommandArgs)
  ['--grant-read-uri-permission', 0],
  ['--grant-write-uri-permission', 0],
  ['--grant-persistable-uri-permission', 0],
  ['--grant-prefix-uri-permission', 0],

  // Intent resolution & selector flags (Intent.parseCommandArgs).
  // Note: `--selector` switches subsequent options (including EAS's appended `-n <pkg>/<activity>`)
  // onto the selector Intent.
  ['--debug-log-resolution', 0],
  ['--exclude-stopped-packages', 0],
  ['--include-stopped-packages', 0],
  ['--selector', 0],

  // Activity intent flags (Intent.parseCommandArgs)
  ['--activity-brought-to-front', 0],
  ['--activity-clear-top', 0],
  ['--activity-clear-when-task-reset', 0],
  ['--activity-exclude-from-recents', 0],
  ['--activity-launched-from-history', 0],
  ['--activity-multiple-task', 0],
  ['--activity-no-animation', 0],
  ['--activity-no-history', 0],
  ['--activity-no-user-action', 0],
  ['--activity-previous-is-top', 0],
  ['--activity-reorder-to-front', 0],
  ['--activity-reset-task-if-needed', 0],
  ['--activity-single-top', 0],
  ['--activity-clear-task', 0],
  ['--activity-task-on-home', 0],
  ['--activity-match-external', 0],

  // Receiver intent flags (Intent.parseCommandArgs)
  ['--receiver-registered-only', 0],
  ['--receiver-replace-pending', 0],
  ['--receiver-foreground', 0],
  ['--receiver-no-abort', 0],
  ['--receiver-include-background', 0],

  // ActivityManagerShellCommand `am start` options
  ['-D', 0],
  ['-N', 0],
  ['-W', 0],
  ['-S', 0],
  ['-P', 1],
  ['-R', 1],
  ['--start-profiler', 1],
  ['--sampling', 1],
  ['--streaming', 0],
  ['--attach-agent', 1],
  ['--attach-agent-bind', 1],
  ['--track-allocation', 0],
  ['--user', 1],
  ['--receiver-permission', 1],
  ['--display', 1],
  ['--task-display-area-feature-id', 1],
  ['--windowingMode', 1],
  ['--activityType', 1],
  ['--task', 1],
  ['--task-overlay', 0],
  ['--lock-task', 0],
  ['--allow-background-activity-starts', 0],
  ['--allow-fgs-start-reason', 1],
  ['--splashscreen-show-icon', 0],
  ['--dismiss-keyguard', 0],
  ['--dismiss-keyguard-if-insecure', 0],
  ['--suspend', 0],
  ['--async', 0],
  ['--clock-type', 1],
  ['--profiler-output-version', 1],
]);

const ANDROID_LAUNCH_ARGS_HINT =
  'Android "launch_args" must use separate "am start" Intent option tokens and values (for example, ["--es", "key", "value"] or ["--ez", "isTest", "true"]), not iOS launch flags or bare positional arguments.';

/**
 * Check Android launch inputs before a session starts or launches an app. Validates `launchArgs`
 * against supported `am start` options and argument arities, and rejects NUL characters or
 * commands that are already too long before the launch component is appended. The launch itself
 * checks the exact command length once the component is known.
 */
export function validateAndroidLaunchOptions({
  launchArgs = [],
  openUrl,
}: {
  launchArgs?: string[];
  openUrl?: string;
}): void {
  quoteAndroidShellCommand(['am', 'start', ...launchArgs, '-n']);
  validateAndroidLaunchArgs(launchArgs);
  if (openUrl) {
    quoteAndroidShellCommand(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', openUrl]);
  }
}

function validateAndroidLaunchArgs(launchArgs: string[]): void {
  let index = 0;
  let hasBasePackage = false;
  let inSelector = false;

  while (index < launchArgs.length) {
    const token = launchArgs[index];
    const position = index + 1;

    if (token === '') {
      throw new UserError(
        'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
        `Invalid Android "launch_args": empty argument at position ${position}. Remove it unless it is an option value (for example, ["--es", "key", ""]). ${ANDROID_LAUNCH_ARGS_HINT}`
      );
    }

    if (token === '-n') {
      throw new UserError(
        'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
        `Invalid Android "launch_args": option "-n" at position ${position} cannot be specified because EAS sets the launch component automatically.`
      );
    }

    if (!token.startsWith('-') || token === '-' || token === '--') {
      throw new UserError(
        'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
        `Invalid Android "launch_args": unexpected argument ${JSON.stringify(token)} at position ${position}. ${ANDROID_LAUNCH_ARGS_HINT}`
      );
    }

    // Require exact option tokens rather than Android's BasicShellCommandHandler attached
    // short-option form (e.g. `-ekey` or `-tvalue`). Attached values collide with iOS-style
    // launch flags such as `-tenantIdentifier`, `-tourSet`, or `-env`, which would otherwise be
    // misparsed as `-t` / `-e` with bogus values instead of rejected upfront.
    const arity = ANDROID_AM_START_OPTION_ARITIES.get(token);
    if (arity === undefined) {
      throw new UserError(
        'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
        `Invalid Android "launch_args": unknown "am start" option ${JSON.stringify(token)} at position ${position}. ${ANDROID_LAUNCH_ARGS_HINT}`
      );
    }

    const remaining = launchArgs.length - (index + 1);
    if (remaining < arity) {
      const expectedArguments = arity === 1 ? '1 argument' : `${arity} arguments`;
      throw new UserError(
        'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
        `Invalid Android "launch_args": option ${JSON.stringify(token)} at position ${position} requires ${expectedArguments}, but only ${remaining} ${remaining === 1 ? 'was' : 'were'} provided. ${ANDROID_LAUNCH_ARGS_HINT}`
      );
    }

    if (!inSelector && token === '-p') {
      hasBasePackage = true;
    } else if (token === '--selector') {
      if (hasBasePackage) {
        throw new UserError(
          'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
          `Invalid Android "launch_args": option "--selector" at position ${position} cannot be combined with "-p" on the base Intent.`
        );
      }
      inSelector = true;
    }

    index += 1 + arity;
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
