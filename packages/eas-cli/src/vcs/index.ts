import chalk from 'chalk';

import GitNoCommitClient from './clients/gitNoCommit';
import NoVcsClient from './clients/noVcs';
import { Client } from './vcs';

const NO_VCS_WARNING = `Using EAS CLI without version control system is not recommended, use this mode only if you know what you are doing.`;

let vcsClient = resolveDefaultVcsClient();

function resolveDefaultVcsClient(): Client {
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
  return new GitNoCommitClient();
}

export function setVcsClient(client: Client): void {
  vcsClient = client;
}

export function getVcsClient(): Client {
  return vcsClient;
}
