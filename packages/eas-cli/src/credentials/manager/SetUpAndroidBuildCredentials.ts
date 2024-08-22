import { Platform } from '@expo/eas-build-job';
import assert from 'assert';

import { AndroidActionType } from './Actions';
import { CheckBuildProfileFlagAgainstEasJson } from './CheckBuildProfileFlagAgainstEasJson';
import { Action } from './HelperActions';
import { ManageAndroid } from './ManageAndroid';
import { CredentialsContext, CredentialsContextProjectInfo } from '../context';

export class SetUpAndroidBuildCredentials extends ManageAndroid {
  constructor(
    callingAction: Action,
    projectDir: string,
    private readonly setUpBuildCredentialsWithProfileNameFromFlag: string
  ) {
    super(callingAction, projectDir);
  }

  override async runAsync(): Promise<void> {
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
        AndroidActionType.SetUpBuildCredentials,
        gradleContext
      );
    }
  }
}
