import { App, Auth } from '@expo/apple-utils';
import { getConfig } from '@expo/config';
import { Flags } from '@oclif/core';

import EasCommand from '../commandUtils/EasCommand';
import Log from '../log';
import { uploadAppleMetadataAsync } from '../metadata/upload';
import { findProjectRootAsync } from '../project/projectUtils';

// TODO(cedric): remove this before merging
export default class Metadata extends EasCommand {
  static description = 'Upload metadata to Apple App Store';
  static aliases = ['metadata'];

  static flags = {
    verbose: Flags.boolean({
      description: 'Print more logs',
    }),
    nonInteractive: Flags.boolean({
      description: 'Do not ask for confirmation',
    }),
  };

  static args = [];

  async runAsync(): Promise<void> {
    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const bundleId = exp.ios?.bundleIdentifier;

    if (!bundleId) {
      throw new Error('No bundle identifier');
    }

    const auth = await Auth.loginAsync();
    const app = await App.findAsync(auth.context, { bundleId });
    if (!app) {
      return Log.warn(`Could not find the App Store Conntect App`);
    }

    await uploadAppleMetadataAsync({
      app,
      auth,
      projectDir,
      metadataFile: './apple-meta.json',
    });
  }
}
