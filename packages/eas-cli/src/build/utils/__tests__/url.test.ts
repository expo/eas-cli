import { getProjectDashboardUrl, getProjectPageUrl } from '../url';

describe(getProjectPageUrl, () => {
  it('builds the project dashboard URL when no page is provided', () => {
    expect(getProjectPageUrl('testuser', 'testapp')).toBe(
      'https://expo.dev/accounts/testuser/projects/testapp'
    );
  });

  it('appends the page path when provided', () => {
    expect(getProjectPageUrl('testuser', 'testapp', 'builds')).toBe(
      'https://expo.dev/accounts/testuser/projects/testapp/builds'
    );
  });

  it('preserves nested page paths without encoding the separator', () => {
    expect(getProjectPageUrl('testuser', 'testapp', 'hosting/deployments')).toBe(
      'https://expo.dev/accounts/testuser/projects/testapp/hosting/deployments'
    );
  });

  it('encodes account and project names', () => {
    expect(getProjectPageUrl('my org', 'my app', 'updates')).toBe(
      'https://expo.dev/accounts/my%20org/projects/my%20app/updates'
    );
  });
});

describe(getProjectDashboardUrl, () => {
  it('matches the page URL with no page', () => {
    expect(getProjectDashboardUrl('testuser', 'testapp')).toBe(
      getProjectPageUrl('testuser', 'testapp')
    );
  });
});
