import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import assert from 'assert';
import nullthrows from 'nullthrows';

import { IosActionType } from './Actions';
import { CheckBuildProfileFlagAgainstEasJson } from './CheckBuildProfileFlagAgainstEasJson';
import { Action } from './HelperActions';
import { SelectIosDistributionTypeGraphqlFromBuildProfile } from './SelectIosDistributionTypeGraphqlFromBuildProfile';
import {
  AccountFragment,
  AppleDistributionCertificateFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType as IosDistributionTypeGraphql,
} from '../../graphql/generated';
import Log from '../../log';
import { resolveXcodeBuildContextAsync } from '../../project/ios/scheme';
import { resolveTargetsAsync } from '../../project/ios/target';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { confirmAsync, selectAsync } from '../../prompts';
import { ensureActorHasPrimaryAccount } from '../../user/actions';
import { CredentialsContext, CredentialsContextProjectInfo } from '../context';
import {
  AppStoreApiKeyPurpose,
  selectAscApiKeysFromAccountAsync,
} from '../ios/actions/AscApiKeyUtils';
import { AssignAscApiKey } from '../ios/actions/AssignAscApiKey';
import { AssignPushKey } from '../ios/actions/AssignPushKey';
import { getAppLookupParamsFromContextAsync } from '../ios/actions/BuildCredentialsUtils';
import { CreateAscApiKey } from '../ios/actions/CreateAscApiKey';
import { CreateDistributionCertificate } from '../ios/actions/CreateDistributionCertificate';
import { CreatePushKey } from '../ios/actions/CreatePushKey';
import { selectValidDistributionCertificateAsync } from '../ios/actions/DistributionCertificateUtils';
import { selectPushKeyAsync } from '../ios/actions/PushKeyUtils';
import { RemoveProvisioningProfiles } from '../ios/actions/RemoveProvisioningProfile';
import { SetUpAdhocProvisioningProfile } from '../ios/actions/SetUpAdhocProvisioningProfile';
import { SetUpAscApiKey } from '../ios/actions/SetUpAscApiKey';
import { SetUpBuildCredentials } from '../ios/actions/SetUpBuildCredentials';
import { SetUpBuildCredentialsFromCredentialsJson } from '../ios/actions/SetUpBuildCredentialsFromCredentialsJson';
import { SetUpProvisioningProfile } from '../ios/actions/SetUpProvisioningProfile';
import { SetUpPushKey } from '../ios/actions/SetUpPushKey';
import { UpdateCredentialsJson } from '../ios/actions/UpdateCredentialsJson';
import { AppLookupParams } from '../ios/api/graphql/types/AppLookupParams';
import { App, Target } from '../ios/types';

export class SetUpIosBuildCredentials {
  constructor(
    private callingAction: Action,
    private projectDir: string,
    private setUpBuildCredentialsWithProfileNameFromFlag: string
  ) {}

  async runAsync(): Promise<void> {
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
      projectDir: process.cwd(),
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
      IosActionType.SetUpBuildCredentials // Directly proceed to SetUpBuildCredentials
    );
  }

  private async createProjectContextAsync(
    ctx: CredentialsContext,
    account: AccountFragment,
    buildProfile: BuildProfile<Platform.IOS>
  ): Promise<{
    app: App;
    targets: Target[];
  }> {
    assert(ctx.hasProjectContext, 'createProjectContextAsync: must have project context.');

    const app = { account, projectName: ctx.exp.slug };
    const xcodeBuildContext = await resolveXcodeBuildContextAsync(
      {
        projectDir: ctx.projectDir,
        nonInteractive: ctx.nonInteractive,
        exp: ctx.exp,
        vcsClient: ctx.vcsClient,
      },
      buildProfile
    );
    const targets = await resolveTargetsAsync({
      exp: ctx.exp,
      projectDir: ctx.projectDir,
      xcodeBuildContext,
      env: buildProfile.env,
      vcsClient: ctx.vcsClient,
    });
    return {
      app,
      targets,
    };
  }

  private async runProjectSpecificActionAsync(
    ctx: CredentialsContext,
    app: App,
    targets: Target[],
    buildProfile: BuildProfile<Platform.IOS>,
    action: IosActionType
  ): Promise<void> {
    if (action === IosActionType.SetUpBuildCredentials) {
      await new SetUpBuildCredentials({
        app,
        targets,
        distribution: buildProfile.distribution,
        enterpriseProvisioning: buildProfile.enterpriseProvisioning,
      }).runAsync(ctx);
      return;
    }

    const distributionType = await new SelectIosDistributionTypeGraphqlFromBuildProfile(
      buildProfile
    ).runAsync(ctx);

    if (action === IosActionType.SetUpBuildCredentialsFromCredentialsJson) {
      await new SetUpBuildCredentialsFromCredentialsJson(app, targets, distributionType).runAsync(
        ctx
      );
      return;
    } else if (action === IosActionType.UpdateCredentialsJson) {
      await new UpdateCredentialsJson(app, targets, distributionType).runAsync(ctx);
      return;
    }

    const target = await this.selectTargetAsync(targets);
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx, target);
    switch (action) {
      case IosActionType.UseExistingDistributionCertificate: {
        const distCert = await selectValidDistributionCertificateAsync(ctx, appLookupParams);
        if (!distCert) {
          return;
        }
        await this.setupProvisioningProfileWithSpecificDistCertAsync(
          ctx,
          target,
          appLookupParams,
          distCert,
          distributionType
        );
        return;
      }
      case IosActionType.CreateDistributionCertificate: {
        const distCert = await new CreateDistributionCertificate(appLookupParams.account).runAsync(
          ctx
        );
        const confirm = await confirmAsync({
          message: `Do you want ${appLookupParams.projectName} to use the new Distribution Certificate?`,
        });
        if (confirm) {
          await this.setupProvisioningProfileWithSpecificDistCertAsync(
            ctx,
            target,
            appLookupParams,
            distCert,
            distributionType
          );
        }
        return;
      }
      case IosActionType.RemoveProvisioningProfile: {
        const iosAppCredentials = await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync(
          ctx.graphqlClient,
          appLookupParams
        );
        const provisioningProfile = iosAppCredentials?.iosAppBuildCredentialsList.find(
          buildCredentials => buildCredentials.iosDistributionType === distributionType
        )?.provisioningProfile;
        if (!provisioningProfile) {
          Log.log(
            `No provisioning profile associated with the ${distributionType} configuration of ${appLookupParams.projectName}`
          );
          return;
        }
        const confirm = await confirmAsync({
          message: `Delete the provisioning profile associated with the ${distributionType} configuration of ${appLookupParams.projectName}?`,
        });
        if (confirm) {
          await new RemoveProvisioningProfiles([appLookupParams], [provisioningProfile]).runAsync(
            ctx
          );
        }
        return;
      }
      case IosActionType.SetUpPushKey: {
        const setupPushKeyAction = await new SetUpPushKey(appLookupParams);
        const isPushKeySetup = await setupPushKeyAction.isPushKeySetupAsync(ctx);
        if (isPushKeySetup) {
          Log.log(
            `Push Key is already set up for ${appLookupParams.projectName} ${appLookupParams.bundleIdentifier}`
          );
        } else {
          await new SetUpPushKey(appLookupParams).runAsync(ctx);
        }
        return;
      }
      case IosActionType.CreatePushKey: {
        const pushKey = await new CreatePushKey(appLookupParams.account).runAsync(ctx);
        const confirm = await confirmAsync({
          message: `Do you want ${appLookupParams.projectName} to use the new Push Key?`,
        });
        if (confirm) {
          await new AssignPushKey(appLookupParams).runAsync(ctx, pushKey);
        }
        return;
      }
      case IosActionType.UseExistingPushKey: {
        const selectedPushKey = await selectPushKeyAsync(ctx, appLookupParams.account);
        if (selectedPushKey) {
          await new AssignPushKey(appLookupParams).runAsync(ctx, selectedPushKey);
        }
        return;
      }
      case IosActionType.SetUpAscApiKeyForSubmissions: {
        await new SetUpAscApiKey(
          appLookupParams,
          AppStoreApiKeyPurpose.SUBMISSION_SERVICE
        ).runAsync(ctx);
        return;
      }
      case IosActionType.UseExistingAscApiKeyForSubmissions: {
        const ascApiKey = await selectAscApiKeysFromAccountAsync(ctx, appLookupParams.account, {
          filterDifferentAppleTeam: true,
        });
        if (ascApiKey) {
          await new AssignAscApiKey(appLookupParams).runAsync(
            ctx,
            ascApiKey,
            AppStoreApiKeyPurpose.SUBMISSION_SERVICE
          );
        }
        return;
      }
      case IosActionType.CreateAscApiKeyForSubmissions: {
        const ascApiKey = await new CreateAscApiKey(appLookupParams.account).runAsync(
          ctx,
          AppStoreApiKeyPurpose.SUBMISSION_SERVICE
        );
        const confirm = await confirmAsync({
          message: `Do you want ${appLookupParams.projectName} to use the new API Key?`,
        });
        if (confirm) {
          await new AssignAscApiKey(appLookupParams).runAsync(
            ctx,
            ascApiKey,
            AppStoreApiKeyPurpose.SUBMISSION_SERVICE
          );
        }
        return;
      }
      default:
        throw new Error('Unknown action selected');
    }
  }

  private async setupProvisioningProfileWithSpecificDistCertAsync(
    ctx: CredentialsContext,
    target: Target,
    appLookupParams: AppLookupParams,
    distCert: AppleDistributionCertificateFragment,
    distributionType: IosDistributionTypeGraphql
  ): Promise<IosAppBuildCredentialsFragment> {
    Log.log(`Setting up ${appLookupParams.projectName} to use Distribution Certificate`);
    Log.log(`Creating provisioning profile...`);
    if (distributionType === IosDistributionTypeGraphql.AdHoc) {
      return await new SetUpAdhocProvisioningProfile({
        app: appLookupParams,
        target,
      }).runWithDistributionCertificateAsync(ctx, distCert);
    } else {
      return await new SetUpProvisioningProfile(
        appLookupParams,
        target,
        distributionType
      ).createAndAssignProfileAsync(ctx, distCert);
    }
  }

  private async selectTargetAsync(targets: Target[]): Promise<Target> {
    if (targets.length === 1) {
      return targets[0];
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
