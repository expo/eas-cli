import { Platform } from '@expo/eas-build-job';
import {
  BuildProfile,
  CredentialsSource,
  JobExpoTokenRole as EasJsonJobExpoTokenRole,
} from '@expo/eas-json';

import { JobExpoTokenRole } from '../../../graphql/generated';
import { resolveJobExpoTokenRole } from '../expoTokenRole';

function createBuildProfile(
  permissions?: BuildProfile<Platform.ANDROID>['permissions']
): BuildProfile<Platform.ANDROID> {
  return {
    credentialsSource: CredentialsSource.REMOTE,
    distribution: 'store',
    permissions,
  };
}

describe(resolveJobExpoTokenRole, () => {
  it('returns undefined when the build profile does not request a role', () => {
    expect(resolveJobExpoTokenRole(createBuildProfile())).toBeUndefined();
  });

  it.each([
    [EasJsonJobExpoTokenRole.RUNNER, JobExpoTokenRole.Runner],
    [EasJsonJobExpoTokenRole.DEVELOPER, JobExpoTokenRole.Developer],
    [EasJsonJobExpoTokenRole.RELEASE_MANAGER, JobExpoTokenRole.ReleaseManager],
  ])('maps the %s role to %s', (role, expected) => {
    expect(resolveJobExpoTokenRole(createBuildProfile({ account: { role } }))).toBe(expected);
  });
});
