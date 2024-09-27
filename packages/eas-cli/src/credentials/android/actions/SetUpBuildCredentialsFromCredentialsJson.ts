import { BackupKeystore } from './DownloadKeystore';
import {
  AndroidAppBuildCredentialsFragment,
  AndroidKeystoreType,
} from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { readAndroidCredentialsAsync } from '../../credentialsJson/read';
import {
  SelectAndroidBuildCredentials,
  SelectAndroidBuildCredentialsResultType,
} from '../../manager/SelectAndroidBuildCredentials';
import { AppLookupParams } from '../api/GraphqlClient';
import { getKeystoreWithType } from '../utils/keystoreNew';

export class SetUpBuildCredentialsFromCredentialsJson {
  constructor(private readonly app: AppLookupParams) {}

  async runAsync(ctx: CredentialsContext): Promise<AndroidAppBuildCredentialsFragment | null> {
    if (ctx.nonInteractive) {
      throw new Error(
        'Setting up build credentials from credentials.json is only available in interactive mode'
      );
    }

    let localCredentials;
    try {
      localCredentials = await readAndroidCredentialsAsync(ctx.projectDir);
    } catch (error) {
      Log.error(
        'Reading credentials from credentials.json failed. Make sure this file is correct and all credentials are present there.'
      );
      throw error;
    }

    const selectBuildCredentialsResult = await new SelectAndroidBuildCredentials(this.app).runAsync(
      ctx
    );
    if (
      selectBuildCredentialsResult.resultType ===
        SelectAndroidBuildCredentialsResultType.EXISTING_CREDENTIALS &&
      selectBuildCredentialsResult.result.androidKeystore
    ) {
      const buildCredentials = selectBuildCredentialsResult.result;
      const confirmOverwrite = await confirmAsync({
        message: `The build configuration ${buildCredentials.name} already has a keystore configured. Overwrite?`,
      });
      if (!confirmOverwrite) {
        return null;
      }
      await new BackupKeystore(this.app).runAsync(ctx, buildCredentials);
    }

    const providedKeystoreWithType = getKeystoreWithType(localCredentials.keystore);
    if (providedKeystoreWithType.type === AndroidKeystoreType.Unknown) {
      const confirmKeystoreIsSketchy = await confirmAsync({
        message: `The keystore you provided could not be parsed and may be corrupt. Proceed anyway?`,
      });
      if (!confirmKeystoreIsSketchy) {
        return null;
      }
    }
    const keystoreFragment = await ctx.android.createKeystoreAsync(
      ctx.graphqlClient,
      this.app.account,
      providedKeystoreWithType
    );
    let buildCredentials: AndroidAppBuildCredentialsFragment;
    if (
      selectBuildCredentialsResult.resultType ===
      SelectAndroidBuildCredentialsResultType.CREATE_REQUEST
    ) {
      buildCredentials = await ctx.android.createAndroidAppBuildCredentialsAsync(
        ctx.graphqlClient,
        this.app,
        {
          ...selectBuildCredentialsResult.result,
          androidKeystoreId: keystoreFragment.id,
        }
      );
    } else {
      buildCredentials = await ctx.android.updateAndroidAppBuildCredentialsAsync(
        ctx.graphqlClient,
        selectBuildCredentialsResult.result,
        {
          androidKeystoreId: keystoreFragment.id,
        }
      );
    }
    Log.succeed('Keystore updated');
    return buildCredentials;
  }
}
