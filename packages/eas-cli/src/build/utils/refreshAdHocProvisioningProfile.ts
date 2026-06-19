import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';

export function resolveRefreshAdHocProvisioningProfile<T extends Platform>({
  platform,
  buildProfile,
  refreshAdHocProvisioningProfileFlag,
}: {
  platform: T;
  buildProfile: BuildProfile<T>;
  refreshAdHocProvisioningProfileFlag?: boolean;
}): boolean {
  if (refreshAdHocProvisioningProfileFlag !== undefined) {
    return refreshAdHocProvisioningProfileFlag;
  }
  if (platform === Platform.IOS) {
    return (
      (buildProfile as BuildProfile<Platform.IOS>).refreshAdHocProvisioningProfile ?? false
    );
  }
  return false;
}

export function assertExplicitRefreshAdHocProvisioningProfileFlagValid({
  refreshAdHocProvisioningProfileFlag,
  nonInteractive,
  freezeCredentials,
}: {
  refreshAdHocProvisioningProfileFlag?: boolean;
  nonInteractive: boolean;
  freezeCredentials: boolean;
}): void {
  if (refreshAdHocProvisioningProfileFlag !== true) {
    return;
  }
  if (!nonInteractive) {
    throw new Error(
      '--refresh-ad-hoc-provisioning-profile can only be used in non-interactive mode.'
    );
  }
  if (freezeCredentials) {
    throw new Error(
      'Cannot use --refresh-ad-hoc-provisioning-profile with --freeze-credentials.'
    );
  }
}

export function assertRefreshAdHocProvisioningProfileCompatibleWithFreezeCredentials(
  refreshAdHocProvisioningProfile: boolean,
  freezeCredentials: boolean
): void {
  if (refreshAdHocProvisioningProfile && freezeCredentials) {
    throw new Error(
      'Cannot refresh ad-hoc provisioning profile when credentials are frozen. Remove --freeze-credentials or disable refreshAdHocProvisioningProfile in eas.json.'
    );
  }
}
