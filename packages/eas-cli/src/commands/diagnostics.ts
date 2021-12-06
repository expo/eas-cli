import { Platform } from '@expo/eas-build-job';
import envinfo from 'envinfo';

import EasCommand from '../commandUtils/EasCommand';
import Log from '../log';
import { findProjectRootAsync } from '../project/projectUtils';
import { resolveWorkflowAsync } from '../project/workflow';
import { easCliVersion } from '../utils/easCli';

export default class Diagnostics extends EasCommand {
  static description = 'log environment info to the console';

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
