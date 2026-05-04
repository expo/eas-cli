import { LockfileData, PackageInfo } from './types';

export function parseNpmLock(content: string): LockfileData | null {
  try {
    const lockfile = JSON.parse(content);
    const rawPackages: Record<
      string,
      {
        version?: string;
        peerDependencies?: Record<string, string>;
        peerDependenciesMeta?: Record<string, { optional?: boolean }>;
      }
    > = lockfile.packages ?? {};
    const packages = new Map<string, PackageInfo>();
    for (const [key, value] of Object.entries(rawPackages)) {
      if (!key.startsWith('node_modules/')) {
        continue;
      }
      const rest = key.slice('node_modules/'.length);
      // Skip nested node_modules (transitive deps)
      if (rest.includes('node_modules/')) {
        continue;
      }
      if (value.version) {
        const optionalPeers = new Set<string>();
        if (value.peerDependenciesMeta) {
          for (const [peer, meta] of Object.entries(value.peerDependenciesMeta)) {
            if (meta.optional) {
              optionalPeers.add(peer);
            }
          }
        }
        packages.set(rest, {
          version: value.version,
          peerDependencies: value.peerDependencies,
          optionalPeers: optionalPeers.size > 0 ? optionalPeers : undefined,
        });
      }
    }
    return { packages };
  } catch {
    return null;
  }
}

export function parseYarnLock(content: string): LockfileData | null {
  try {
    const packages = new Map<string, PackageInfo>();
    const lines = content.split('\n');
    let currentPackage: string | null = null;

    for (const line of lines) {
      // Entry header: not indented, not a comment, ends with ':'
      if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('#') && line.endsWith(':')) {
        // Examples:
        //   yarn v1: react@^19.0.0:  or  "react@^19.0.0":
        //   yarn v2+: "react@npm:^19.0.0":
        const entry = line.replace(/^"/, '').replace(/:$/, '').replace(/"$/, '');
        const atIndex = entry.indexOf('@', entry.startsWith('@') ? 1 : 0);
        if (atIndex > 0) {
          currentPackage = entry.slice(0, atIndex);
        }
      }

      // Version line (indented): `  version "19.0.0"` or `  version: 19.0.0`
      if (currentPackage) {
        const versionMatch = line.match(/^\s+version:?\s+"?([^"\s]+)"?/);
        if (versionMatch) {
          if (!packages.has(currentPackage)) {
            packages.set(currentPackage, { version: versionMatch[1] });
          }
          currentPackage = null;
        }
      }
    }
    // yarn.lock doesn't include peer dependency info
    return { packages };
  } catch {
    return null;
  }
}

export function parsePnpmLock(content: string): LockfileData | null {
  try {
    const packages = new Map<string, PackageInfo>();
    // Match entries in the packages section like:
    //   react@19.0.0:   or   @types/react@19.0.0:
    const packageRegex = /^ {2}((?:@[\w.-]+\/)?[\w.-]+)@(\d+[^:\s]*?):/gm;
    let match;
    while ((match = packageRegex.exec(content)) !== null) {
      if (!packages.has(match[1])) {
        packages.set(match[1], { version: match[2] });
      }
    }
    // pnpm-lock.yaml doesn't readily expose peer deps in a parseable way without YAML
    return { packages };
  } catch {
    return null;
  }
}

export function parseBunLock(content: string): LockfileData | null {
  try {
    // bun.lock is JSONC (has trailing commas) — strip them for JSON.parse
    const jsonContent = content.replace(/,(\s*[}\]])/g, '$1');
    const lockfile = JSON.parse(jsonContent);
    const rawPackages: Record<string, unknown[]> = lockfile.packages ?? {};
    const packages = new Map<string, PackageInfo>();
    for (const [name, value] of Object.entries(rawPackages)) {
      // Format: "react": ["react@19.0.0", "", { peerDependencies: {...}, optionalPeers: [...] }, "sha512-..."]
      if (Array.isArray(value) && typeof value[0] === 'string') {
        const entry: string = value[0];
        const atIndex = entry.lastIndexOf('@');
        if (atIndex > 0) {
          const meta = (typeof value[2] === 'object' && value[2] !== null ? value[2] : {}) as {
            peerDependencies?: Record<string, string>;
            optionalPeers?: string[];
          };
          packages.set(name, {
            version: entry.slice(atIndex + 1),
            peerDependencies: meta.peerDependencies,
            optionalPeers: meta.optionalPeers ? new Set(meta.optionalPeers) : undefined,
          });
        }
      }
    }
    return { packages };
  } catch {
    return null;
  }
}

export function parseLockfile(
  content: string,
  manager: string,
  lockfilePath: string
): LockfileData | null {
  switch (manager) {
    case 'npm':
      return parseNpmLock(content);
    case 'yarn':
      return parseYarnLock(content);
    case 'pnpm':
      return parsePnpmLock(content);
    case 'bun':
      // bun.lockb is binary — can only parse the text variant
      if (lockfilePath.endsWith('.lockb')) {
        return null;
      }
      return parseBunLock(content);
    default:
      return null;
  }
}
