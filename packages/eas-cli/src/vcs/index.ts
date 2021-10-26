import log from '../log';
import GitNoCommitClient from './clients/gitNoCommit';
import NoVcsClient from './clients/noVcs';
import { Client } from './vcs';

const NO_VCS_WARNING = `Using EAS CLI without version control system is not recommended, use this mode only if you know what you are doing.`;

let vcsClient = resolveDefaultVcsClient();

function resolveDefaultVcsClient(): Client {
  if (process.env.EAS_NO_VCS) {
    if (process.env.NODE_ENV !== 'test') {
      log.warn(NO_VCS_WARNING);
    }
    return new NoVcsClient();
  }
  return new GitNoCommitClient();
}

export function setVcsClient(client: Client): void {
  vcsClient = client;
}

export default (): Client => vcsClient;
