import { ActionInfo, IosActionType, Scope } from './Actions';
import { CredentialsContext } from '../context';

export const highLevelActions: ActionInfo[] = [
  {
    value: IosActionType.ManageBuildCredentials,
    title: 'Build Credentials: Manage everything needed to build your project',
    scope: Scope.Manager,
  },
  {
    value: IosActionType.ManagePushKey,
    title: 'Push Notifications: Manage your Apple Push Notifications Key',
    scope: Scope.Manager,
  },
  {
    value: IosActionType.ManageAscApiKey,
    title: 'App Store Connect: Manage your API Key',
    scope: Scope.Manager,
  },
  {
    value: IosActionType.ManageCredentialsJson,
    title: 'credentials.json: Upload/Download credentials between EAS servers and your local json ',
    scope: Scope.Manager,
  },
  {
    value: IosActionType.GoBackToCaller,
    title: 'Go back',
    scope: Scope.Manager,
  },
  {
    value: IosActionType.Exit,
    title: 'Exit',
    scope: Scope.Manager,
  },
];

export const credentialsJsonActions: ActionInfo[] = [
  {
    value: IosActionType.UpdateCredentialsJson,
    title: 'Download credentials from EAS to credentials.json',
    scope: Scope.Project,
  },
  {
    value: IosActionType.SetUpBuildCredentialsFromCredentialsJson,
    title: 'Upload credentials from credentials.json to EAS',
    scope: Scope.Project,
  },
  {
    value: IosActionType.GoBackToHighLevelActions,
    title: 'Go back',
    scope: Scope.Manager,
  },
];

export function getPushKeyActions(ctx: CredentialsContext): ActionInfo[] {
  return [
    {
      value: IosActionType.SetUpPushKey,
      title: 'Set up your project to use Push Notifications',
      scope: Scope.Project,
    },
    {
      value: IosActionType.CreatePushKey,
      title: 'Add a new push key',
      scope: ctx.hasProjectContext ? Scope.Project : Scope.Account,
    },
    {
      value: IosActionType.UseExistingPushKey,
      title: 'Use an existing push key',
      scope: Scope.Project,
    },
    {
      value: IosActionType.RemovePushKey,
      title: 'Remove a push key from your account',
      scope: Scope.Account,
    },
    {
      value: IosActionType.GoBackToHighLevelActions,
      title: 'Go back',
      scope: Scope.Manager,
    },
  ];
}

export function getAscApiKeyActions(ctx: CredentialsContext): ActionInfo[] {
  return [
    {
      value: IosActionType.SetUpAscApiKeyForSubmissions,
      title: 'Set up your project to use an API Key for EAS Submit',
      scope: Scope.Project,
    },
    {
      value: IosActionType.UseExistingAscApiKeyForSubmissions,
      title: 'Use an existing API Key for EAS Submit',
      scope: Scope.Project,
    },
    {
      value: IosActionType.CreateAscApiKeyForSubmissions,
      title: 'Add a new API Key For EAS Submit',
      scope: ctx.hasProjectContext ? Scope.Project : Scope.Account,
    },
    {
      value: IosActionType.RemoveAscApiKey,
      title: 'Delete an API Key',
      scope: Scope.Account,
    },
    {
      value: IosActionType.GoBackToHighLevelActions,
      title: 'Go back',
      scope: Scope.Manager,
    },
  ];
}

export function getBuildCredentialsActions(ctx: CredentialsContext): ActionInfo[] {
  return [
    {
      // This command will be triggered during build to ensure all credentials are ready
      // I'm leaving it here for now to simplify testing
      value: IosActionType.SetUpBuildCredentials,
      title: 'All: Set up all the required credentials to build your project',
      scope: Scope.Project,
    },
    {
      value: IosActionType.UseExistingDistributionCertificate,
      title: 'Distribution Certificate: Use an existing one for your project',
      scope: Scope.Project,
    },
    {
      value: IosActionType.CreateDistributionCertificate,
      title: `Distribution Certificate: Add a new one to your account`,
      scope: ctx.hasProjectContext ? Scope.Project : Scope.Account,
    },
    {
      value: IosActionType.RemoveDistributionCertificate,
      title: 'Distribution Certificate: Delete one from your account',
      scope: Scope.Account,
    },
    {
      value: IosActionType.RemoveProvisioningProfile,
      title: 'Provisioning Profile: Delete one from your project',
      scope: Scope.Project,
    },
    {
      value: IosActionType.GoBackToHighLevelActions,
      title: 'Go back',
      scope: Scope.Manager,
    },
  ];
}
