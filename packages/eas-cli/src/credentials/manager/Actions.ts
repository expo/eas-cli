export type ActionInfo = {
  value: AndroidActionType | IosActionType;
  title: string;
  scope: Scope;
};

export enum Scope {
  Project,
  Manager,
  Account,
}

export enum AndroidActionType {
  ManageBuildCredentials,
  ManageFcm,
  ManageGoogleServiceAccountKeyForSubmissions,
  ManageGoogleServiceAccount,
  ManageGoogleServiceAccountKeyForFcmV1,
  ManageCredentialsJson,
  GoBackToCaller,
  GoBackToHighLevelActions,
  CreateKeystore,
  SetDefaultKeystore,
  DownloadKeystore,
  RemoveKeystore,
  CreateFcm,
  RemoveFcm,
  CreateGsaKey,
  UseExistingGsaKeyForSubmissions,
  RemoveGsaKey,
  SetUpGsaKeyForSubmissions,
  CreateGsaKeyForFcmV1,
  UseExistingGsaKeyForFcmV1,
  RemoveGsaKeyForFcmV1,
  SetUpGsaKeyForFcmV1,
  UpdateCredentialsJson,
  SetUpBuildCredentialsFromCredentialsJson,
  SetUpBuildCredentials,
  Exit,
}

export enum IosActionType {
  ManageCredentialsJson,
  ManageBuildCredentials,
  ManagePushKey,
  ManageAscApiKey,
  GoBackToCaller,
  GoBackToHighLevelActions,
  SetUpBuildCredentials,
  SetUpBuildCredentialsFromCredentialsJson,
  UpdateCredentialsJson,
  UseExistingDistributionCertificate,
  RemoveProvisioningProfile,
  CreateDistributionCertificate,
  RemoveDistributionCertificate,
  SetUpPushKey,
  CreatePushKey,
  UseExistingPushKey,
  RemovePushKey,
  SetUpAscApiKeyForSubmissions,
  UseExistingAscApiKeyForSubmissions,
  CreateAscApiKeyForSubmissions,
  RemoveAscApiKey,
  Exit,
}
