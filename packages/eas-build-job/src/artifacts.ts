export enum ManagedArtifactType {
  APPLICATION_ARCHIVE = 'APPLICATION_ARCHIVE',
  BUILD_ARTIFACTS = 'BUILD_ARTIFACTS',
  SOURCE_MAP = 'SOURCE_MAP',
  /**
   * @deprecated
   */
  XCODE_BUILD_LOGS = 'XCODE_BUILD_LOGS',
}

export enum WorkflowArtifactType {
  ANDROID_APK = 'android-apk',
  ANDROID_AAB = 'android-aab',

  IOS_SIMULATOR_APP = 'ios-simulator-app',
  IOS_IPA = 'ios-ipa',

  OTHER = 'other',
}

export const isWorkflowArtifact = <
  TSpec extends { type: WorkflowArtifactType | ManagedArtifactType },
>(
  artifactSpec: TSpec
): artifactSpec is TSpec & { type: WorkflowArtifactType } => {
  if (Object.values(WorkflowArtifactType).includes(artifactSpec.type as WorkflowArtifactType)) {
    return true;
  }
  return false;
};
