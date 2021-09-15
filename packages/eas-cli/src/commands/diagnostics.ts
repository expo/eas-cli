import { Command } from '@oclif/command';
import envinfo from 'envinfo';

import Log from '../log';

const packageJSON = require('../../package.json');

export default class Diagnostics extends Command {
  static description = 'log environment info to the console';

  async run(): Promise<void> {
    const info = await envinfo.run(
      {
        System: ['OS', 'Shell'],
        Binaries: ['Node', 'Yarn', 'npm'],
        Utilities: ['Git'],
        npmPackages: [
          'expo',
          'react',
          'react-dom',
          'react-native',
          'react-native-web',
          'react-navigation',
          '@expo/webpack-config',
        ],
        npmGlobalPackages: ['eas-cli'],
      },
      {
        title: `EAS CLI ${packageJSON.version} environment info`,
      }
    );
    Log.log(info);
  }
}
