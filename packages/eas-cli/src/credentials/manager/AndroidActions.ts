import { ActionInfo, AndroidActionType, Scope } from './Actions';

export const highLevelActions: ActionInfo[] = [
  {
    value: AndroidActionType.ManageBuildCredentials,
    title: 'Keystore: Manage everything needed to build your project',
    scope: Scope.Manager,
  },
  {
    value: AndroidActionType.ManageFcm,
    title: 'Push Notifications: Manage your FCM API Key',
    scope: Scope.Manager,
  },
  {
    value: AndroidActionType.ManageGoogleServiceAccountKey,
    title: 'Google Service Account: Manage your Service Account Key',
    scope: Scope.Manager,
  },
  {
    value: AndroidActionType.ManageCredentialsJson,
    title: 'credentials.json: Upload/Download credentials between EAS servers and your local json ',
    scope: Scope.Manager,
  },
  {
    value: AndroidActionType.GoBackToCaller,
    title: 'Go back',
    scope: Scope.Manager,
  },
];

export const credentialsJsonActions: ActionInfo[] = [
  {
    value: AndroidActionType.UpdateCredentialsJson,
    title: 'Download credentials from EAS to credentials.json',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.SetUpBuildCredentialsFromCredentialsJson,
    title: 'Upload credentials from credentials.json to EAS',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.GoBackToHighLevelActions,
    title: 'Go back',
    scope: Scope.Manager,
  },
];

export const buildCredentialsActions: ActionInfo[] = [
  {
    value: AndroidActionType.CreateKeystore,
    title: 'Set up a new keystore',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.SetDefaultKeystore,
    title: 'Change default keystore',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.DownloadKeystore,
    title: 'Download existing keystore',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.RemoveKeystore,
    title: 'Delete your keystore',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.GoBackToHighLevelActions,
    title: 'Go back',
    scope: Scope.Manager,
  },
];

export const fcmActions: ActionInfo[] = [
  {
    value: AndroidActionType.CreateFcm,
    title: 'Upload an FCM API Key',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.RemoveFcm,
    title: 'Delete your FCM API Key',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.GoBackToHighLevelActions,
    title: 'Go back',
    scope: Scope.Manager,
  },
];

export const gsaKeyActions: ActionInfo[] = [
  {
    value: AndroidActionType.SetUpGsaKey,
    title: 'Set up a Google Service Account Key',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.CreateGsaKey,
    title: 'Upload a Google Service Account Key',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.UseExistingGsaKey,
    title: 'Use an existing Google Service Account Key',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.RemoveGsaKey,
    title: 'Delete a Google Service Account Key',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.GoBackToHighLevelActions,
    title: 'Go back',
    scope: Scope.Manager,
  },
];
