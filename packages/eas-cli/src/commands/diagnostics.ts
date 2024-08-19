import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';
import envinfo from 'envinfo';

import EasCommand from '../commandUtils/EasCommand';
import Log from '../log';
import { ora } from '../ora';
import { resolveWorkflowAsync } from '../project/workflow';
import { easCliVersion } from '../utils/easCli';
import { Client } from '../vcs/vcs';

export default class Diagnostics extends EasCommand {
  static override description = 'display environment info';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { projectDir, vcsClient } = await this.getContextAsync(Diagnostics, {
      nonInteractive: true,
    });

    const spinner = ora().start(`Gathering diagnostic information...`);
    const info = await envinfo.run(
      {
        System: ['OS', 'Shell'],
        Binaries: ['Node', 'Yarn', 'npm'],
        Utilities: ['Git'],
        npmPackages: [
          'expo',
          'expo-cli',
          'react',
          'react-dom',
          'react-native',
          'react-native-web',
          'react-navigation',
          '@expo/webpack-config',
          'expo-dev-client',
          'expo-updates',
        ],
        npmGlobalPackages: ['eas-cli', 'expo-cli'],
      },
      {
        title: chalk.bold(`EAS CLI ${easCliVersion} environment info`),
      }
    );
    spinner.succeed('All needed information gathered!');

    Log.log(info.trimEnd());
    await this.printWorkflowAsync(projectDir, vcsClient);
    Log.newLine();
  }

  private async printWorkflowAsync(projectDir: string, vcsClient: Client): Promise<void> {
    const androidWorkflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID, vcsClient);
    const iosWorkflow = await resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient);

    if (androidWorkflow === iosWorkflow) {
      Log.log(`    Project workflow: ${androidWorkflow}`);
    } else {
      Log.log(`    Project workflow:`);
      Log.log(`      Android: ${androidWorkflow}`);
      Log.log(`      iOS: ${iosWorkflow}`);
    }
  }
}
