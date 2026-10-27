import { vol } from 'memfs';

import { ensureLockfileExistsAsync } from '../validateLockfile';

jest.mock('fs');

const mockResolveWorkspaceRoot = jest.fn();
jest.mock('@expo/package-manager', () => {
  const actual = jest.requireActual('@expo/package-manager');
  return {
    ...actual,
    resolveWorkspaceRoot: (...args: unknown[]) => mockResolveWorkspaceRoot(...args),
  };
});

beforeEach(() => {
  vol.reset();
  mockResolveWorkspaceRoot.mockReturnValue(null);
});

describe(ensureLockfileExistsAsync, () => {
  it('passes when package-lock.json exists', async () => {
    vol.fromJSON({ './package-lock.json': '' }, '/app');
    await expect(ensureLockfileExistsAsync('/app')).resolves.not.toThrow();
  });

  it('passes when yarn.lock exists', async () => {
    vol.fromJSON({ './yarn.lock': '' }, '/app');
    await expect(ensureLockfileExistsAsync('/app')).resolves.not.toThrow();
  });

  it('passes when pnpm-lock.yaml exists', async () => {
    vol.fromJSON({ './pnpm-lock.yaml': '' }, '/app');
    await expect(ensureLockfileExistsAsync('/app')).resolves.not.toThrow();
  });

  it('passes when bun.lockb exists', async () => {
    vol.fromJSON({ './bun.lockb': '' }, '/app');
    await expect(ensureLockfileExistsAsync('/app')).resolves.not.toThrow();
  });

  it('passes when bun.lock exists', async () => {
    vol.fromJSON({ './bun.lock': '' }, '/app');
    await expect(ensureLockfileExistsAsync('/app')).resolves.not.toThrow();
  });

  it('throws when no lockfile exists', async () => {
    vol.fromJSON({ './package.json': '{}' }, '/app');
    await expect(ensureLockfileExistsAsync('/app')).rejects.toThrow(
      'No lockfile found in the project directory.'
    );
  });

  it('passes when lockfile exists in workspace root', async () => {
    vol.fromJSON(
      {
        './packages/my-app/package.json': '{}',
        './yarn.lock': '',
      },
      '/monorepo'
    );
    mockResolveWorkspaceRoot.mockReturnValue('/monorepo');
    await expect(
      ensureLockfileExistsAsync('/monorepo/packages/my-app')
    ).resolves.not.toThrow();
  });

  it('throws when no lockfile in project dir or workspace root', async () => {
    vol.fromJSON(
      {
        './packages/my-app/package.json': '{}',
        './package.json': '{}',
      },
      '/monorepo'
    );
    mockResolveWorkspaceRoot.mockReturnValue('/monorepo');
    await expect(ensureLockfileExistsAsync('/monorepo/packages/my-app')).rejects.toThrow(
      'No lockfile found in the project directory.'
    );
  });
});
