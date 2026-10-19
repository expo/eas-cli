import { Permission, Role } from '../../graphql/generated';
import { getRoleForPermissions } from '../roles';

describe(getRoleForPermissions, () => {
  it.each([
    [
      Role.Owner,
      [
        Permission.Own,
        Permission.Admin,
        Permission.PublishProtected,
        Permission.Publish,
        Permission.Run,
        Permission.View,
      ],
    ],
    [
      Role.Admin,
      [
        Permission.Admin,
        Permission.PublishProtected,
        Permission.Publish,
        Permission.Run,
        Permission.View,
      ],
    ],
    [
      Role.ReleaseManager,
      [Permission.PublishProtected, Permission.Publish, Permission.Run, Permission.View],
    ],
    [Role.Developer, [Permission.Publish, Permission.Run, Permission.View]],
    [Role.Runner, [Permission.Run, Permission.View]],
    [Role.ViewOnly, [Permission.View]],
  ])('returns %s for its exact permission set', (role, permissions) => {
    expect(getRoleForPermissions(permissions)).toBe(role);
    expect(getRoleForPermissions([...permissions].reverse())).toBe(role);
  });

  it.each([
    [[]],
    [[Permission.Admin, Permission.View]],
    [[Permission.Publish, Permission.View]],
    [[Permission.Own, Permission.View]],
    [[Permission.Run]],
  ])('returns CUSTOM for %j', permissions => {
    expect(getRoleForPermissions(permissions)).toBe(Role.Custom);
  });
});
