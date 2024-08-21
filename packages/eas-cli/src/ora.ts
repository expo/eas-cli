import { boolish } from 'getenv';
// eslint-disable-next-line
import oraReal, { Options, Ora } from 'ora';

import Log from './log';

export { Ora, Options };

// eslint-disable-next-line no-console
const logReal = console.log;
// eslint-disable-next-line no-console
const infoReal = console.info;
// eslint-disable-next-line no-console
const warnReal = console.warn;
// eslint-disable-next-line no-console
const errorReal = console.error;

const isCi = boolish('CI', false);

/**
 * A custom ora spinner that sends the stream to stdout in CI, or non-TTY, instead of stderr (the default).
 *
 * @param options
 * @returns
 */
export function ora(options?: Options | string): Ora {
  const inputOptions = typeof options === 'string' ? { text: options } : options ?? {};
  const disabled = Log.isDebug || !process.stdin.isTTY || isCi;
  const spinner = oraReal({
    // Ensure our non-interactive mode emulates CI mode.
    isEnabled: !disabled,
    // In non-interactive mode, send the stream to stdout so it prevents looking like an error.
    stream: disabled ? process.stdout : process.stderr,
    ...inputOptions,
  });

  const oraStart = spinner.start.bind(spinner);
  const oraStop = spinner.stop.bind(spinner);
  const oraStopAndPersist = spinner.stopAndPersist.bind(spinner);

  const logWrap = (method: any, args: any[]): void => {
    oraStop();
    method(...args);
    spinner.start();
  };

  const wrapNativeLogs = (): void => {
    // eslint-disable-next-line no-console
    console.log = (...args: any) => {
      logWrap(logReal, args);
    };
    // eslint-disable-next-line no-console
    console.info = (...args: any) => {
      logWrap(infoReal, args);
    };
    // eslint-disable-next-line no-console
    console.warn = (...args: any) => {
      logWrap(warnReal, args);
    };
    // eslint-disable-next-line no-console
    console.error = (...args: any) => {
      logWrap(errorReal, args);
    };
  };

  const resetNativeLogs = (): void => {
    // eslint-disable-next-line no-console
    console.log = logReal;
    // eslint-disable-next-line no-console
    console.info = infoReal;
    // eslint-disable-next-line no-console
    console.warn = warnReal;
    // eslint-disable-next-line no-console
    console.error = errorReal;
  };

  spinner.start = (text): Ora => {
    // wrapNativeLogs wraps calls to console so they always:
    // 1. stop the spinner
    // 2. log the message
    // 3. start the spinner again
    // Every restart of the spinner causes the spinner message to be logged again
    // which makes logs look like
    //
    // - Exporting...
    // [expo-cli] Starting Metro Bundler
    // - Exporting...
    // [expo-cli] Android Bundling complete 3492ms
    // - Exporting...
    //
    // Skipping wrapping native logs removes the repeated interleaved "Exporting..." messages.
    if (!disabled) {
      wrapNativeLogs();
    }

    return oraStart(text);
  };

  spinner.stopAndPersist = (options): Ora => {
    const result = oraStopAndPersist(options);
    resetNativeLogs();
    return result;
  };

  spinner.stop = (): Ora => {
    const result = oraStop();
    resetNativeLogs();
    return result;
  };

  return spinner;
}
