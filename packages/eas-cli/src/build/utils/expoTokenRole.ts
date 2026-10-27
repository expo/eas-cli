import { Platform } from '@expo/eas-build-job';
import { BuildProfile, JobExpoTokenRole as EasJsonJobExpoTokenRole } from '@expo/eas-json';

import { JobExpoTokenRole } from '../../graphql/generated';

const easJsonJobExpoTokenRoleToJobExpoTokenRoleMapping: Record<
  EasJsonJobExpoTokenRole,
  JobExpoTokenRole
> = {
  [EasJsonJobExpoTokenRole.RUNNER]: JobExpoTokenRole.Runner,
  [EasJsonJobExpoTokenRole.DEVELOPER]: JobExpoTokenRole.Developer,
  [EasJsonJobExpoTokenRole.RELEASE_MANAGER]: JobExpoTokenRole.ReleaseManager,
};

export function resolveJobExpoTokenRole<T extends Platform>(
  profile: BuildProfile<T>
): JobExpoTokenRole | undefined {
  const role = profile.permissions?.account.role;
  return role ? easJsonJobExpoTokenRoleToJobExpoTokenRoleMapping[role] : undefined;
}
