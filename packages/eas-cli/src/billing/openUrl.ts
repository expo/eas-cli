import Log, { link } from '../log';
import { ora } from '../ora';

import openBrowser = require('open');

/**
 * Opens a URL in the browser, printing a clickable fallback when a browser cannot be launched.
 * When `open` is false the URL is only printed (used for `--non-interactive` / `--no-open`).
 */
export async function openOrPrintUrlAsync(
  url: string,
  { label, open }: { label: string; open: boolean }
): Promise<void> {
  if (!open) {
    Log.log(`${label}: ${link(url)}`);
    return;
  }

  // Use `open` rather than `better-opn`: better-opn runs the URL through `encodeURI` before
  // launching the browser, which double-encodes the already-percent-encoded Stripe checkout
  // fragment (e.g. `%2F` -> `%252F`) and corrupts the URL. `open` passes it verbatim.
  const spinner = ora(`Opening ${label.toLowerCase()}`).start();
  let opened = false;
  try {
    await openBrowser(url);
    opened = true;
  } catch (error) {
    Log.debug(`Failed to open a web browser: ${error}`);
  }

  if (opened) {
    spinner.succeed(`Opened ${label.toLowerCase()} in your browser`);
  } else {
    spinner.fail('Unable to open a web browser automatically.');
  }
  // Always print the URL so it is available whether or not the browser opened.
  Log.log(`${label}: ${link(url)}`);
}
