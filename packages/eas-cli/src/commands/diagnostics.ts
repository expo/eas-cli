import { Platform } from '@expo/eas-build-job';
import envinfo from 'envinfo';

import EasCommand from '../commandUtils/EasCommand.js';
import Log from '../log.js';
import { findProjectRootAsync } from '../project/projectUtils.js';
import { resolveWorkflowAsync } from '../project/workflow.js';
import { easCliVersion } from '../utils/easCli.js';

export default class Diagnostics extends EasCommand {
  static description = 'display environment info';

  protected requiresAuthentication = false;

  async runAsync(): Promise<void> {
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
        title: `EAS CLI ${easCliVersion} environment info`,
      }
    );

    Log.log(info.trimEnd());
    await this.printWorkflowAsync();
    Log.newLine();
  }

  private async printWorkflowAsync(): Promise<void> {
    const projectDir = await findProjectRootAsync();
    const androidWorkflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID);
    const iosWorkflow = await resolveWorkflowAsync(projectDir, Platform.IOS);

    if (androidWorkflow === iosWorkflow) {
      Log.log(`    Project workflow: ${androidWorkflow}`);
    } else {
      Log.log(`    Project Workflow:`);
      Log.log(`      Android: ${androidWorkflow}`);
      Log.log(`      iOS: ${iosWorkflow}`);
    }
  }
}
