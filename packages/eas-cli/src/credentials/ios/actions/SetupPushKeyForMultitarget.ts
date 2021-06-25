import { CommonIosAppCredentialsFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { findApplicationTarget } from '../../../project/ios/target';
import { confirmAsync } from '../../../prompts';
import { Context } from '../../context';
import { Target } from '../types';
import { getAppFromContext } from './BuildCredentialsUtils';
import { SetupPushKey } from './SetupPushKey';

/**
 * Setup a push key for the main target of a multitarget application
 */
export class SetupPushKeyForMultitarget {
  public async runAsync(
    ctx: Context,
    targets: Target[]
  ): Promise<CommonIosAppCredentialsFragment | null> {
    const applicationTarget = findApplicationTarget(targets);
    const app = getAppFromContext(ctx);
    const appLookupParams = {
      ...app,
      bundleIdentifier: applicationTarget.bundleIdentifier,
      parentBundleIdentifier: applicationTarget.parentBundleIdentifier,
    };

    const setupPushKeyAction = new SetupPushKey(appLookupParams);
    const isPushKeySetup = await setupPushKeyAction.isPushKeySetupAsync(ctx);
    if (isPushKeySetup) {
      Log.succeed(
        `Push Notifications setup for ${app.projectName}:${applicationTarget.bundleIdentifier}`
      );
      return null;
    }

    const confirmSetup = await confirmAsync({
      message: `Would you like to setup Push Notifications for your project?`,
    });
    if (!confirmSetup) {
      return null;
    }
    return await setupPushKeyAction.runAsync(ctx);
  }
}
