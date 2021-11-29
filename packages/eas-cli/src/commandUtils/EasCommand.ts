import { EasJsonReader } from '@expo/eas-json';
import { Command } from '@oclif/command';
import semver from 'semver';

import {
  AnalyticsEvent,
  flushAsync as flushAnalyticsAsync,
  initAsync as initAnalyticsAsync,
  logEvent,
} from '../analytics/rudderstackClient';
import { findProjectRootAsync } from '../project/projectUtils';
import { getUserAsync } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import { easCliVersion } from '../utils/easCli';
import { setVcsClient } from '../vcs';
import GitClient from '../vcs/clients/git';

export default abstract class EasCommand extends Command {
  /**
   * When user data is unavailable locally, determines if the command will
   * force the user to log in
   */
  protected requiresAuthentication = true;

  protected abstract runAsync(): Promise<any>;

  // eslint-disable-next-line async-protect/async-suffix
  async run(): Promise<any> {
    await initAnalyticsAsync();
    await this.applyCliConfigAsync();

    if (this.requiresAuthentication) {
      const { flags } = this.parse();
      const nonInteractive = (flags as any)['non-interactive'] ?? false;
      await ensureLoggedInAsync({ nonInteractive });
    } else {
      await getUserAsync();
    }
    logEvent(AnalyticsEvent.ACTION, {
      // id is assigned by oclif in constructor based on the filepath:
      // commands/submit === submit, commands/build/list === build:list
      action: `eas ${this.id}`,
    });
    return this.runAsync();
  }

  // eslint-disable-next-line async-protect/async-suffix
  async finally(err: Error): Promise<any> {
    await flushAnalyticsAsync();
    return super.finally(err);
  }

  private async applyCliConfigAsync(): Promise<void> {
    const projectDir = await findProjectRootAsync();
    const easJsonReader = new EasJsonReader(projectDir);
    const config = await easJsonReader.getCliConfigAsync();
    if (config?.version && !semver.satisfies(easCliVersion, config.version)) {
      throw new Error(
        `You are on eas-cli@${easCliVersion} which does not satisfy the CLI version constraint in eas.json (${config.version})`
      );
    }
    if (config?.requireCommit) {
      setVcsClient(new GitClient());
    }
  }
}
