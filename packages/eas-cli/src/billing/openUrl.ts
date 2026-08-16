import Log, { link } from '../log';
import { ora } from '../ora';

import openBrowser = require('open');

export async function openOrPrintUrlAsync(
  url: string,
  { label, open }: { label: string; open: boolean }
): Promise<void> {
  if (!open) {
    Log.log(`${label}: ${link(url)}`);
    return;
  }

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
  Log.log(`${label}: ${link(url)}`);
}
