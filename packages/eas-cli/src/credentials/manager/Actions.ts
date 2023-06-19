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
  ManageGoogleServiceAccountKey,
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
  UseExistingGsaKey,
  RemoveGsaKey,
  SetUpGsaKey,
  UpdateCredentialsJson,
  SetUpBuildCredentialsFromCredentialsJson,
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
}
