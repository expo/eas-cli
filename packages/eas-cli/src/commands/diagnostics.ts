import envinfo from 'envinfo';

import EasCommand from '../commandUtils/EasCommand';
import Log from '../log';

const packageJSON = require('../../package.json');

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
        title: `EAS CLI ${packageJSON.version} environment info`,
      }
    );
    Log.log(info);
  }
}
