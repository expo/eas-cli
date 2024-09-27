import { ActionInfo, AndroidActionType, Scope } from './Actions';

export const highLevelActions: ActionInfo[] = [
  {
    value: AndroidActionType.ManageBuildCredentials,
    title: 'Keystore: Manage everything needed to build your project',
    scope: Scope.Manager,
  },
  {
    value: AndroidActionType.ManageGoogleServiceAccount,
    title: 'Google Service Account',
    scope: Scope.Manager,
  },
  {
    value: AndroidActionType.ManageFcm,
    title: 'Push Notifications (Legacy): Manage your FCM (Legacy) API Key',
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
  {
    value: AndroidActionType.Exit,
    title: 'Exit',
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

export const gsaKeyActionsForFcmV1: ActionInfo[] = [
  {
    value: AndroidActionType.SetUpGsaKeyForFcmV1,
    title: 'Set up a Google Service Account Key for Push Notifications (FCM V1)',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.UseExistingGsaKeyForFcmV1,
    title: 'Select an existing Google Service Account Key for Push Notifications (FCM V1)',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.GoBackToHighLevelActions,
    title: 'Go back',
    scope: Scope.Manager,
  },
];

export const gsaKeyActionsForSubmissions: ActionInfo[] = [
  {
    value: AndroidActionType.SetUpGsaKeyForSubmissions,
    title: 'Set up a Google Service Account Key for Play Store Submissions',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.UseExistingGsaKeyForSubmissions,
    title: 'Select an existing Google Service Account Key for Play Store Submissions',
    scope: Scope.Project,
  },
  {
    value: AndroidActionType.GoBackToHighLevelActions,
    title: 'Go back',
    scope: Scope.Manager,
  },
];

export const gsaActions: ActionInfo[] = [
  {
    value: AndroidActionType.ManageGoogleServiceAccountKeyForSubmissions,
    title: 'Manage your Google Service Account Key for Play Store Submissions',
    scope: Scope.Manager,
  },
  {
    value: AndroidActionType.ManageGoogleServiceAccountKeyForFcmV1,
    title: 'Manage your Google Service Account Key for Push Notifications (FCM V1)',
    scope: Scope.Manager,
  },
  {
    value: AndroidActionType.CreateGsaKey,
    title: 'Upload a Google Service Account Key',
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
