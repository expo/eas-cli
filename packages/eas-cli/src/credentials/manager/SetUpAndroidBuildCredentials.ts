import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import assert from 'assert';

import { AndroidActionType } from './Actions';
import { CheckBuildProfileFlagAgainstEasJson } from './CheckBuildProfileFlagAgainstEasJson';
import { CreateAndroidBuildCredentials } from './CreateAndroidBuildCredentials';
import { Action } from './HelperActions';
import { SelectExistingAndroidBuildCredentials } from './SelectAndroidBuildCredentials';
import { SetDefaultAndroidKeystore } from './SetDefaultAndroidKeystore';
import { GradleBuildContext, resolveGradleBuildContextAsync } from '../../project/android/gradle';
import { AssignFcm } from '../android/actions/AssignFcm';
import { AssignGoogleServiceAccountKeyForFcmV1 } from '../android/actions/AssignGoogleServiceAccountKeyForFcmV1';
import { AssignGoogleServiceAccountKeyForSubmissions } from '../android/actions/AssignGoogleServiceAccountKeyForSubmissions';
import { getAppLookupParamsFromContextAsync } from '../android/actions/BuildCredentialsUtils';
import { CreateFcm } from '../android/actions/CreateFcm';
import { CreateGoogleServiceAccountKey } from '../android/actions/CreateGoogleServiceAccountKey';
import { DownloadKeystore } from '../android/actions/DownloadKeystore';
import { RemoveFcm } from '../android/actions/RemoveFcm';
import { SelectAndRemoveGoogleServiceAccountKey } from '../android/actions/RemoveGoogleServiceAccountKey';
import { RemoveKeystore } from '../android/actions/RemoveKeystore';
import { SetUpBuildCredentialsFromCredentialsJson } from '../android/actions/SetUpBuildCredentialsFromCredentialsJson';
import { SetUpGoogleServiceAccountKeyForFcmV1 } from '../android/actions/SetUpGoogleServiceAccountKeyForFcmV1';
import { SetUpGoogleServiceAccountKeyForSubmissions } from '../android/actions/SetUpGoogleServiceAccountKeyForSubmissions';
import { UpdateCredentialsJson } from '../android/actions/UpdateCredentialsJson';
import { UseExistingGoogleServiceAccountKey } from '../android/actions/UseExistingGoogleServiceAccountKey';
import { CredentialsContext, CredentialsContextProjectInfo } from '../context';

export class SetUpAndroidBuildCredentials {
  constructor(
    private callingAction: Action,
    private projectDir: string,
    private setUpBuildCredentialsWithProfileNameFromFlag: string
  ) {}

  async runAsync(): Promise<void> {
    const hasProjectContext = !!this.callingAction.projectInfo;
    const buildProfile = hasProjectContext
      ? await new CheckBuildProfileFlagAgainstEasJson(
          this.projectDir,
          Platform.ANDROID,
          this.setUpBuildCredentialsWithProfileNameFromFlag
        ).runAsync()
      : null;
    let projectInfo: CredentialsContextProjectInfo | null = null;
    if (hasProjectContext) {
      const { exp, projectId } = await this.callingAction.getDynamicPrivateProjectConfigAsync({
        env: buildProfile?.env,
      });
      projectInfo = { exp, projectId };
    }
    const ctx = new CredentialsContext({
      projectDir: process.cwd(),
      projectInfo,
      user: this.callingAction.actor,
      graphqlClient: this.callingAction.graphqlClient,
      analytics: this.callingAction.analytics,
      env: buildProfile?.env,
      nonInteractive: false,
      vcsClient: this.callingAction.vcsClient,
    });

    let gradleContext;
    if (ctx.hasProjectContext) {
      assert(buildProfile, 'buildProfile must be defined in a project context');
      gradleContext = await this.createProjectContextAsync(ctx, buildProfile);
    }

    if (this.setUpBuildCredentialsWithProfileNameFromFlag) {
      await this.runProjectSpecificActionAsync(
        ctx,
        AndroidActionType.CreateKeystore, // Directly proceed to CreateKeystore
        gradleContext
      );
    }
  }

  private async createProjectContextAsync(
    ctx: CredentialsContext,
    buildProfile: BuildProfile<Platform.ANDROID>
  ): Promise<GradleBuildContext | undefined> {
    assert(ctx.hasProjectContext, 'createProjectContextAsync: must have project context.');
    return await resolveGradleBuildContextAsync(ctx.projectDir, buildProfile, ctx.vcsClient);
  }

  private async runProjectSpecificActionAsync(
    ctx: CredentialsContext,
    action: AndroidActionType,
    gradleContext?: GradleBuildContext
  ): Promise<void> {
    assert(
      ctx.hasProjectContext,
      'You must be in your project directory in order to perform this action'
    );
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx, gradleContext);
    if (action === AndroidActionType.CreateKeystore) {
      await new CreateAndroidBuildCredentials(appLookupParams).runAsync(ctx);
    } else if (action === AndroidActionType.SetDefaultKeystore) {
      await new SetDefaultAndroidKeystore(appLookupParams).runAsync(ctx);
    } else if (action === AndroidActionType.DownloadKeystore) {
      const buildCredentials = await new SelectExistingAndroidBuildCredentials(
        appLookupParams
      ).runAsync(ctx);
      if (buildCredentials) {
        await new DownloadKeystore({ app: appLookupParams }).runAsync(ctx, buildCredentials);
      }
    } else if (action === AndroidActionType.RemoveKeystore) {
      const buildCredentials = await new SelectExistingAndroidBuildCredentials(
        appLookupParams
      ).runAsync(ctx);
      if (buildCredentials) {
        await new RemoveKeystore(appLookupParams).runAsync(ctx, buildCredentials);
      }
    } else if (action === AndroidActionType.CreateFcm) {
      const fcm = await new CreateFcm(appLookupParams.account).runAsync(ctx);
      await new AssignFcm(appLookupParams).runAsync(ctx, fcm);
    } else if (action === AndroidActionType.RemoveFcm) {
      await new RemoveFcm(appLookupParams).runAsync(ctx);
    } else if (action === AndroidActionType.SetUpGsaKeyForSubmissions) {
      await new SetUpGoogleServiceAccountKeyForSubmissions(appLookupParams).runAsync(ctx);
    } else if (action === AndroidActionType.UseExistingGsaKeyForSubmissions) {
      const gsaKey = await new UseExistingGoogleServiceAccountKey(appLookupParams.account).runAsync(
        ctx
      );
      if (gsaKey) {
        await new AssignGoogleServiceAccountKeyForSubmissions(appLookupParams).runAsync(
          ctx,
          gsaKey
        );
      }
    } else if (action === AndroidActionType.SetUpGsaKeyForFcmV1) {
      await new SetUpGoogleServiceAccountKeyForFcmV1(appLookupParams).runAsync(ctx);
    } else if (action === AndroidActionType.UseExistingGsaKeyForFcmV1) {
      const gsaKey = await new UseExistingGoogleServiceAccountKey(appLookupParams.account).runAsync(
        ctx
      );
      if (gsaKey) {
        await new AssignGoogleServiceAccountKeyForFcmV1(appLookupParams).runAsync(ctx, gsaKey);
      }
    } else if (action === AndroidActionType.CreateGsaKey) {
      await new CreateGoogleServiceAccountKey(appLookupParams.account).runAsync(ctx);
    } else if (action === AndroidActionType.RemoveGsaKey) {
      await new SelectAndRemoveGoogleServiceAccountKey(appLookupParams.account).runAsync(ctx);
    } else if (action === AndroidActionType.UpdateCredentialsJson) {
      const buildCredentials = await new SelectExistingAndroidBuildCredentials(
        appLookupParams
      ).runAsync(ctx);
      if (buildCredentials) {
        await new UpdateCredentialsJson().runAsync(ctx, buildCredentials);
      }
    } else if (action === AndroidActionType.SetUpBuildCredentialsFromCredentialsJson) {
      await new SetUpBuildCredentialsFromCredentialsJson(appLookupParams).runAsync(ctx);
    }
  }
}
