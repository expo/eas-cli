import { Permission, Role } from '../graphql/generated';

type MockRole =
  | Role.Owner
  | Role.Admin
  | Role.ReleaseManager
  | Role.Developer
  | Role.Runner
  | Role.ViewOnly;

const PERMISSIONS_FOR_ROLE: Record<MockRole, Permission[]> = {
  [Role.Owner]: [
    Permission.Own,
    Permission.Admin,
    Permission.PublishProtected,
    Permission.Publish,
    Permission.Run,
    Permission.View,
  ],
  [Role.Admin]: [
    Permission.Admin,
    Permission.PublishProtected,
    Permission.Publish,
    Permission.Run,
    Permission.View,
  ],
  [Role.ReleaseManager]: [
    Permission.PublishProtected,
    Permission.Publish,
    Permission.Run,
    Permission.View,
  ],
  [Role.Developer]: [Permission.Publish, Permission.Run, Permission.View],
  [Role.Runner]: [Permission.Run, Permission.View],
  [Role.ViewOnly]: [Permission.View],
};

/**
 * A `viewerUserPermission2` value whose permissions resolve to `role` via `getRoleForPermissions`.
 */
export function getMockViewerUserPermission(role: MockRole): {
  permissions: Permission[];
  effectivePermissions: Permission[];
} {
  const permissions = PERMISSIONS_FOR_ROLE[role];
  return { permissions, effectivePermissions: permissions };
}
