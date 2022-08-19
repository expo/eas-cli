import { Platform } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import assert from 'assert';

import EasCommand from '../../../../commandUtils/EasCommand';
import { CredentialsContext } from '../../../../credentials/context';
import { AssignPushKey } from '../../../../credentials/ios/actions/AssignPushKey';
import { getAppLookupParamsFromContext } from '../../../../credentials/ios/actions/BuildCredentialsUtils';
import { CreatePushKey } from '../../../../credentials/ios/actions/CreatePushKey';
import { PushKey } from '../../../../credentials/ios/appstore/Credentials.types';
import { Target } from '../../../../credentials/ios/types';
import { SelectBuildProfileFromEasJson } from '../../../../credentials/manager/SelectBuildProfileFromEasJson';
import {
  processAnswerAsync,
  produceAbsolutePath,
} from '../../../../credentials/utils/promptForCredentials';
import { resolveXcodeBuildContextAsync } from '../../../../project/ios/scheme';
import { resolveTargetsAsync } from '../../../../project/ios/target';
import { getProjectAccountName } from '../../../../project/projectUtils';
import { selectAsync } from '../../../../prompts';
import { findAccountByName } from '../../../../user/Account';
import { ensureActorHasUsername, ensureLoggedInAsync } from '../../../../user/actions';

export default class CredentialsIosPushUpload extends EasCommand {
  static description = 'upload ios push notification credentials';

  static flags = {
    'key-id': Flags.string({
      description: 'Push Key ID (ex: 123AB4C56D).',
      required: false,
    }),
    'key-p8-path': Flags.file({
      description: 'Path to your Push Key .p8 file.',
      required: false,
      exists: true,
    }),
    'team-id': Flags.string({
      description: 'Apple Team ID.',
      required: false,
    }),
    'team-name': Flags.string({
      description: 'Apple Team Name.',
      required: false,
    }),
    profile: Flags.string({
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
      helpValue: 'PROFILE_NAME',
      required: false,
    }),
    'non-interactive': Flags.boolean({
      default: false,
      description: 'Run command in non-interactive mode',
    }),
  };

  async runAsync(): Promise<void> {
    const {
      flags: {
        'key-id': apnsKeyId,
        'key-p8-path': apnsKeyP8Path,
        'team-id': teamId,
        'team-name': teamName,
        'non-interactive': nonInteractive,
        profile: profileName,
      },
    } = await this.parse(CredentialsIosPushUpload);

    const pushKey = await this.getPushKeyFromFlagsAsync({
      apnsKeyId,
      apnsKeyP8Path,
      teamId,
      teamName,
      nonInteractive,
    });

    const projectDir = process.cwd();
    const hasProjectContext = !!CredentialsContext.getExpoConfigInProject(projectDir);
    const buildProfile = hasProjectContext
      ? await new SelectBuildProfileFromEasJson(projectDir, Platform.IOS, nonInteractive).runAsync(
          profileName
        )
      : null;
    const ctx = new CredentialsContext({
      projectDir,
      user: await ensureLoggedInAsync(),
      nonInteractive,
      env: buildProfile?.env,
    });

    const accountName = ctx.hasProjectContext
      ? getProjectAccountName(ctx.exp, ctx.user)
      : ensureActorHasUsername(ctx.user);
    const account = findAccountByName(ctx.user.accounts, accountName);
    if (!account) {
      throw new Error(`You do not have access to account: ${accountName}`);
    }

    assert(buildProfile, 'buildProfile must be defined in project context');
    const xcodeBuildContext = await resolveXcodeBuildContextAsync(
      {
        projectDir,
        nonInteractive: ctx.nonInteractive,
        exp: ctx.exp,
      },
      buildProfile
    );
    const targets = await resolveTargetsAsync({
      exp: ctx.exp,
      projectDir,
      xcodeBuildContext,
      env: buildProfile.env,
    });

    const target = await this.selectTargetAsync(ctx, targets);
    const appLookupParams = getAppLookupParamsFromContext(ctx, target);

    const applePushKeyFragment = await new CreatePushKey(account).runAsync(ctx, pushKey);

    await new AssignPushKey(appLookupParams).runAsync(ctx, applePushKeyFragment);
  }

  private async getPushKeyFromFlagsAsync({
    nonInteractive,
    apnsKeyP8Path,
    apnsKeyId,
    teamId,
    teamName,
  }: Omit<Partial<PushKey>, 'apnsKeyP8'> & {
    apnsKeyP8Path: string | undefined;
    nonInteractive: boolean | undefined;
  }): Promise<PushKey | undefined> {
    if (!apnsKeyP8Path || !teamId || !apnsKeyId) {
      if (nonInteractive) {
        throw new Error(
          'Must supply --key-id and --key-p8-path and --team-id when in non-interactive mode'
        );
      }
      return;
    }

    const apnsKeyP8AbsolutePath = produceAbsolutePath(apnsKeyP8Path);
    const apnsKeyP8 = await processAnswerAsync(
      {
        field: 'key-p8-path',
        question: 'key-p8-path',
        type: 'file',
      },
      apnsKeyP8AbsolutePath
    );
    return {
      apnsKeyP8,
      apnsKeyId,
      teamId,
      teamName,
    };
  }

  private async selectTargetAsync(ctx: CredentialsContext, targets: Target[]): Promise<Target> {
    if (targets.length === 1) {
      return targets[0];
    }
    if (!ctx.nonInteractive) {
      throw new Error(`A target cannot be selected in non-interactive mode.`);
    }
    return await selectAsync<Target>(
      'Which target do you want to use?',
      targets.map(target => ({
        title: `${target.targetName} (Bundle Identifier: ${target.bundleIdentifier})`,
        value: target,
      }))
    );
  }
}
