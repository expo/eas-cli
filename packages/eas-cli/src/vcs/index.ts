import chalk from 'chalk';

import GitClient from './clients/git';
import GitNoCommitClient from './clients/gitNoCommit';
import NoVcsClient from './clients/noVcs';
import { Client } from './vcs';

const NO_VCS_WARNING = `Using EAS CLI without version control system is not recommended, use this mode only if you know what you are doing.`;

export function resolveVcsClient(requireCommit: boolean = false): Client {
  if (process.env.EAS_NO_VCS) {
    if (process.env.NODE_ENV !== 'test') {
      // This log might be printed before cli arguments are evaluated,
      // so it needs to go to stderr in case command is run in JSON
      // only mode.
      // eslint-disable-next-line no-console
      console.error(chalk.yellow(NO_VCS_WARNING));
    }
    return new NoVcsClient();
  }
  if (requireCommit) {
    return new GitClient();
  }
  return new GitNoCommitClient();
}
