import { Platform } from '@expo/eas-build-job';
import getenv from 'getenv';

import { isUserAuthCtx } from '../../credentials/ios/appstore/authenticate';
import { promptAsync } from '../../prompts';
import UserSettings from '../../user/UserSettings';
import { SubmissionContext } from '../context';
export enum AppSpecificPasswordSourceType {
  userDefined,
}

interface AppSpecificPasswordSourceBase {
  sourceType: AppSpecificPasswordSourceType;
}

interface AppSpecificPasswordUserDefinedSource extends AppSpecificPasswordSourceBase {
  sourceType: AppSpecificPasswordSourceType.userDefined;
  appSpecificPassword: string;
}

export interface AppSpecificPasswordCredentials {
  password: string;
  appleIdUsername: string;
}

export type AppSpecificPasswordSource = AppSpecificPasswordUserDefinedSource;

export async function getAppSpecificPasswordLocallyAsync(
  ctx: SubmissionContext<Platform.IOS>,
  source: AppSpecificPasswordSource
): Promise<AppSpecificPasswordCredentials> {
  if (source.sourceType === AppSpecificPasswordSourceType.userDefined) {
    return {
      password: source.appSpecificPassword,
      appleIdUsername: await getAppleIdUsernameAsync(ctx),
    };
  } else {
    // exhaustive -- should never happen
    throw new Error(`Unknown app specific password source type "${(source as any)?.sourceType}"`);
  }
}

export async function getAppleIdUsernameAsync(
  ctx: SubmissionContext<Platform.IOS>
): Promise<string> {
  if (ctx.profile.appleId) {
    return ctx.profile.appleId;
  }

  const envAppleId = getenv.string('EXPO_APPLE_ID', '');
  if (envAppleId) {
    return envAppleId;
  }

  if (isUserAuthCtx(ctx.credentialsCtx.appStore.authCtx)) {
    return ctx.credentialsCtx.appStore.authCtx.appleId;
  }

  // Get the email address that was last used and set it as
  // the default value for quicker authentication.
  const lastAppleId = await UserSettings.getAsync('appleId', null);

  if (ctx.nonInteractive) {
    if (lastAppleId) {
      return lastAppleId;
    } else {
      throw new Error('Set appleId in the submit profile (eas.json).');
    }
  }

  const { appleId } = await promptAsync({
    type: 'text',
    name: 'appleId',
    message: `Enter your Apple ID:`,
    validate: (val: string) => !!val,
    initial: lastAppleId ?? undefined,
  });
  return appleId;
}
