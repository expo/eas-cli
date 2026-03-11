import { parseLockfile, parseNpmLock, parseYarnLock, parsePnpmLock, parseBunLock } from '../parsers';

const NPM_LOCKFILE = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    'node_modules/react': { version: '19.0.4' },
    'node_modules/react-native': { version: '0.79.4' },
    'node_modules/react/node_modules/loose-envify': { version: '1.4.0' },
  },
});

const NPM_LOCKFILE_WITH_PEERS = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    'node_modules/react': { version: '19.0.0' },
    'node_modules/react-dom': {
      version: '19.2.4',
      peerDependencies: { react: '^19.2.4' },
    },
    'node_modules/@0no-co/graphql.web': {
      version: '1.2.0',
      peerDependencies: { graphql: '^14.0.0 || ^15.0.0 || ^16.0.0' },
      peerDependenciesMeta: { graphql: { optional: true } },
    },
  },
});

const YARN_LOCKFILE = `# yarn lockfile v1

react@19.0.4:
  version "19.0.4"
  resolved "https://registry.yarnpkg.com/react/-/react-19.0.4.tgz"

react-native@~0.79.0:
  version "0.79.4"
  resolved "https://registry.yarnpkg.com/react-native/-/react-native-0.79.4.tgz"
`;

const BUN_LOCKFILE = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "dependencies": {
        "react": "19.0.4",
      },
    },
  },
  "packages": {
    "react": ["react@19.0.4", "", {}, "sha512-abc"],
    "react-dom": ["react-dom@19.2.4", "", { "peerDependencies": { "react": "^19.2.4" } }, "sha512-def"],
    "@0no-co/graphql.web": ["@0no-co/graphql.web@1.2.0", "", { "peerDependencies": { "graphql": "^16.0.0" }, "optionalPeers": ["graphql"] }, "sha512-ghi"],
  },
}`;

const PNPM_LOCKFILE = `lockfileVersion: '9.0'

packages:
  react@19.0.4:
    resolution: {integrity: sha512-abc}
  @types/react@19.0.4:
    resolution: {integrity: sha512-def}
`;

describe('parseNpmLock', () => {
  it('parses top-level packages', () => {
    const result = parseNpmLock(NPM_LOCKFILE);
    expect(result).not.toBeNull();
    expect(result!.packages.get('react')?.version).toBe('19.0.4');
    expect(result!.packages.get('react-native')?.version).toBe('0.79.4');
  });

  it('skips nested node_modules (transitive deps)', () => {
    const result = parseNpmLock(NPM_LOCKFILE);
    expect(result!.packages.has('loose-envify')).toBe(false);
  });

  it('parses peer dependencies and optional peers', () => {
    const result = parseNpmLock(NPM_LOCKFILE_WITH_PEERS);
    const reactDom = result!.packages.get('react-dom');
    expect(reactDom?.peerDependencies).toEqual({ react: '^19.2.4' });
    expect(reactDom?.optionalPeers).toBeUndefined();

    const graphqlWeb = result!.packages.get('@0no-co/graphql.web');
    expect(graphqlWeb?.optionalPeers?.has('graphql')).toBe(true);
  });

  it('returns null for invalid JSON', () => {
    expect(parseNpmLock('not json')).toBeNull();
  });
});

describe('parseYarnLock', () => {
  it('parses package versions', () => {
    const result = parseYarnLock(YARN_LOCKFILE);
    expect(result).not.toBeNull();
    expect(result!.packages.get('react')?.version).toBe('19.0.4');
    expect(result!.packages.get('react-native')?.version).toBe('0.79.4');
  });
});

describe('parsePnpmLock', () => {
  it('parses package versions including scoped packages', () => {
    const result = parsePnpmLock(PNPM_LOCKFILE);
    expect(result).not.toBeNull();
    expect(result!.packages.get('react')?.version).toBe('19.0.4');
    expect(result!.packages.get('@types/react')?.version).toBe('19.0.4');
  });
});

describe('parseBunLock', () => {
  it('parses package versions from JSONC format', () => {
    const result = parseBunLock(BUN_LOCKFILE);
    expect(result).not.toBeNull();
    expect(result!.packages.get('react')?.version).toBe('19.0.4');
  });

  it('parses peer dependencies and optional peers', () => {
    const result = parseBunLock(BUN_LOCKFILE);
    const reactDom = result!.packages.get('react-dom');
    expect(reactDom?.peerDependencies).toEqual({ react: '^19.2.4' });

    const graphqlWeb = result!.packages.get('@0no-co/graphql.web');
    expect(graphqlWeb?.optionalPeers?.has('graphql')).toBe(true);
  });

  it('returns null for invalid content', () => {
    expect(parseBunLock('not json at all {')).toBeNull();
  });
});

describe('parseLockfile', () => {
  it('dispatches to the correct parser by manager', () => {
    expect(parseLockfile(NPM_LOCKFILE, 'npm', 'package-lock.json')).not.toBeNull();
    expect(parseLockfile(YARN_LOCKFILE, 'yarn', 'yarn.lock')).not.toBeNull();
    expect(parseLockfile(PNPM_LOCKFILE, 'pnpm', 'pnpm-lock.yaml')).not.toBeNull();
    expect(parseLockfile(BUN_LOCKFILE, 'bun', 'bun.lock')).not.toBeNull();
  });

  it('returns null for binary bun.lockb', () => {
    expect(parseLockfile('binary', 'bun', 'bun.lockb')).toBeNull();
  });

  it('returns null for unknown manager', () => {
    expect(parseLockfile('{}', 'deno', 'deno.lock')).toBeNull();
  });
});
