import { screenshotArtifactDetails } from '../deviceRunSessionScreenshotNames';

const timestamp = '2026-09-24T08-45-59-123Z';
const name = 'Screenshot 2026-09-24 08:45:59 UTC';
const gitCommitHash = 'a1b2c3d' + '0'.repeat(33);
const session = {
  platform: 'IOS' as const,
  app: { slug: 'workflow-project' },
  build: { id: 'installed-build', gitCommitHash, app: { slug: 'my-app' } },
};

it('omits the commit for archive and empty sessions', () => {
  expect(screenshotArtifactDetails(timestamp, { ...session, build: null })).toEqual({
    name,
    filename: `workflow-project-ios-${timestamp}.png`,
    metadata: { __eas_type: 'screenshot', appSlug: 'workflow-project', platform: 'ios' },
  });
});

it.each([null, 'not-a-commit'])('omits a missing or invalid build commit: %s', gitCommitHash => {
  const result = screenshotArtifactDetails(timestamp, {
    ...session,
    build: { ...session.build, gitCommitHash },
  });
  expect(result.filename).toBe(`my-app-ios-${timestamp}.png`);
  expect(result.metadata.gitCommitHash).toBeUndefined();
});

it('sanitizes and bounds the app slug for filesystem-safe names', () => {
  const result = screenshotArtifactDetails(timestamp, {
    ...session,
    build: { ...session.build, app: { slug: '../../My App/' + 'x'.repeat(100) } },
  });
  expect(result.filename).toMatch(/^My-App-x+-ios-a1b2c3d-/);
  expect(result.filename).not.toMatch(/[/\\]/);
  expect(result.filename.length).toBeLessThan(150);
});

it('accepts a full SHA-256 commit hash', () => {
  const gitCommitHash = 'b'.repeat(64);
  const result = screenshotArtifactDetails(timestamp, {
    ...session,
    build: { ...session.build, gitCommitHash },
  });
  expect(result.filename).toBe(`my-app-ios-bbbbbbb-${timestamp}.png`);
  expect(result.metadata.gitCommitHash).toBe(gitCommitHash);
});
