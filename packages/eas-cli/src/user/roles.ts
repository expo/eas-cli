import { Permission, Role } from '../graphql/generated';

/**
 * Derives a member's role from their exact permission set. Mirrors `getRoleForPermissions` in www
 * (server/www/src/utils/roles.ts): any other combination is CUSTOM.
 */
export function getRoleForPermissions(permissions: readonly Permission[]): Role {
  const canOwn = permissions.includes(Permission.Own);
  const canAdmin = permissions.includes(Permission.Admin);
  const canPublishProtected = permissions.includes(Permission.PublishProtected);
  const canPublish = permissions.includes(Permission.Publish);
  const canRun = permissions.includes(Permission.Run);
  const canView = permissions.includes(Permission.View);
  if (canOwn && canAdmin && canPublishProtected && canPublish && canRun && canView) {
    return Role.Owner;
  } else if (!canOwn && canAdmin && canPublishProtected && canPublish && canRun && canView) {
    return Role.Admin;
  } else if (!canOwn && !canAdmin && canPublishProtected && canPublish && canRun && canView) {
    return Role.ReleaseManager;
  } else if (!canOwn && !canAdmin && !canPublishProtected && canPublish && canRun && canView) {
    return Role.Developer;
  } else if (!canOwn && !canAdmin && !canPublishProtected && !canPublish && canRun && canView) {
    return Role.Runner;
  } else if (!canOwn && !canAdmin && !canPublishProtected && !canPublish && !canRun && canView) {
    return Role.ViewOnly;
  }
  return Role.Custom;
}
