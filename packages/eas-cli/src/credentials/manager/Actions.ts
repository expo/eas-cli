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
  DownloadKeystore,
  RemoveKeystore,
  CreateFcm,
  RemoveFcm,
  CreateGsaKey,
  UseExistingGsaKey,
  RemoveGsaKey,
  SetupGsaKey,
  UpdateCredentialsJson,
  SetupBuildCredentialsFromCredentialsJson,
}

export enum IosActionType {
  ManageCredentialsJson,
  ManageBuildCredentials,
  ManagePushKey,
  ManageAscApiKey,
  GoBackToCaller,
  GoBackToHighLevelActions,
  SetupBuildCredentials,
  SetupBuildCredentialsFromCredentialsJson,
  UpdateCredentialsJson,
  UseExistingDistributionCertificate,
  RemoveProvisioningProfile,
  CreateDistributionCertificate,
  RemoveDistributionCertificate,
  SetupPushKey,
  CreatePushKey,
  UseExistingPushKey,
  RemovePushKey,
  CreateAscApiKeyForSubmissions,
  RemoveAscApiKey,
}
