import { Platform } from '@expo/eas-build-job';
import assert from 'assert';
import nullthrows from 'nullthrows';

import { IosActionType } from './Actions';
import { CheckBuildProfileFlagAgainstEasJson } from './CheckBuildProfileFlagAgainstEasJson';
import { Action } from './HelperActions';
import { ManageIos } from './ManageIos';
import { AccountFragment } from '../../graphql/generated';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { ensureActorHasPrimaryAccount } from '../../user/actions';
import { CredentialsContext, CredentialsContextProjectInfo } from '../context';

export class SetUpIosBuildCredentials extends ManageIos {
  constructor(
    callingAction: Action,
    projectDir: string,
    private readonly setUpBuildCredentialsWithProfileNameFromFlag: string
  ) {
    super(callingAction, projectDir);
  }

  override async runAsync(): Promise<void> {
    const buildProfile = this.callingAction.projectInfo
      ? await new CheckBuildProfileFlagAgainstEasJson(
          this.projectDir,
          Platform.IOS,
          this.setUpBuildCredentialsWithProfileNameFromFlag
        ).runAsync()
      : null;

    let projectInfo: CredentialsContextProjectInfo | null = null;
    if (this.callingAction.projectInfo) {
      const { exp, projectId } = await this.callingAction.getDynamicPrivateProjectConfigAsync({
        env: buildProfile?.env,
      });
      projectInfo = { exp, projectId };
    }

    const ctx = new CredentialsContext({
      projectDir: this.projectDir,
      projectInfo,
      user: this.callingAction.actor,
      graphqlClient: this.callingAction.graphqlClient,
      analytics: this.callingAction.analytics,
      env: buildProfile?.env,
      nonInteractive: false,
      vcsClient: this.callingAction.vcsClient,
    });

    await ctx.bestEffortAppStoreAuthenticateAsync();

    const getAccountForProjectAsync = async (projectId: string): Promise<AccountFragment> => {
      return await getOwnerAccountForProjectIdAsync(ctx.graphqlClient, projectId);
    };

    const account = ctx.hasProjectContext
      ? await getAccountForProjectAsync(ctx.projectId)
      : ensureActorHasPrimaryAccount(ctx.user);

    let app = null;
    let targets = null;
    if (ctx.hasProjectContext) {
      assert(buildProfile, 'buildProfile must be defined in project context');
      const projectContext = await this.createProjectContextAsync(ctx, account, buildProfile);
      app = projectContext.app;
      targets = projectContext.targets;
    }

    await this.runProjectSpecificActionAsync(
      ctx,
      nullthrows(app, 'app must be defined in project context'),
      nullthrows(targets, 'targets must be defined in project context'),
      nullthrows(buildProfile, 'buildProfile must be defined in project context'),
      IosActionType.SetUpBuildCredentials
    );
  }
}
