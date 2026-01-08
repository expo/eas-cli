export enum ManagedArtifactType {
  APPLICATION_ARCHIVE = 'APPLICATION_ARCHIVE',
  BUILD_ARTIFACTS = 'BUILD_ARTIFACTS',
  /**
   * @deprecated
   */
  XCODE_BUILD_LOGS = 'XCODE_BUILD_LOGS',
}

export enum GenericArtifactType {
  ANDROID_APK = 'android-apk',
  ANDROID_AAB = 'android-aab',

  IOS_SIMULATOR_APP = 'ios-simulator-app',
  IOS_IPA = 'ios-ipa',

  OTHER = 'other',
}

export const isGenericArtifact = <
  TSpec extends { type: GenericArtifactType | ManagedArtifactType },
>(
  artifactSpec: TSpec
): artifactSpec is TSpec & { type: GenericArtifactType } => {
  if (Object.values(GenericArtifactType).includes(artifactSpec.type as GenericArtifactType)) {
    return true;
  }
  return false;
};
