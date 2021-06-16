import log from '../log';
import GitClient from './git';
import LocalClient from './local';
import { Client } from './vcs';

const NO_VCS_WARNING = `Using eas-cli without version control system is not recomended, use this mode only if you know what you are doing.`;

function resolveVcsClient(): Client {
  try {
    if (process.env.EAS_NO_VCS) {
      log.warn(NO_VCS_WARNING);
      return new LocalClient();
    }
  } catch {}
  return new GitClient();
}

export default resolveVcsClient();
