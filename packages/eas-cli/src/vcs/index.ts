import chalk from 'chalk';

import GitClient from './clients/git';
import NoVcsClient from './clients/noVcs';
import { Client } from './vcs';

const NO_VCS_WARNING = `Using EAS CLI without version control system is not recommended, use this mode only if you know what you are doing.`;

let wasNoVcsWarningPrinted = false;

export function resolveVcsClient(requireCommit: boolean = false): Client {
  if (process.env.EAS_NO_VCS) {
    if (process.env.NODE_ENV !== 'test') {
      if (!wasNoVcsWarningPrinted) {
        // This log might be printed before cli arguments are evaluated,
        // so it needs to go to stderr in case command is run in JSON
        // only mode.
        // eslint-disable-next-line no-console
        console.error(chalk.yellow(NO_VCS_WARNING));
        wasNoVcsWarningPrinted = true;
      }
    }
    return new NoVcsClient();
  }
  return new GitClient({ requireCommit });
}
