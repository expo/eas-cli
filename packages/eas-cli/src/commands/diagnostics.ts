import { Platform } from '@expo/eas-build-job';
import envinfo from 'envinfo';

import EasCommand, { EASCommandProjectDirContext } from '../commandUtils/EasCommand';
import Log from '../log';
import { resolveWorkflowAsync } from '../project/workflow';
import { easCliVersion } from '../utils/easCli';

export default class Diagnostics extends EasCommand {
  static override description = 'display environment info';

  static override contextDefinition = {
    ...EASCommandProjectDirContext,
  };

  async runAsync(): Promise<void> {
    const { projectDir } = await this.getContextAsync(Diagnostics, {
      nonInteractive: true,
    });

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
    await this.printWorkflowAsync(projectDir);
    Log.newLine();
  }

  private async printWorkflowAsync(projectDir: string): Promise<void> {
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
