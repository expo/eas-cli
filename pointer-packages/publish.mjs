#!/usr/bin/env node
/* eslint-disable no-console */
// Publishes the eas-cli pointer packages that pin the eas-cli version used
// on EAS Build infrastructure. See pointer-packages/README.md.
//
// Usage:
//   node pointer-packages/publish.mjs --eas-cli-version <version> [--target staging|production|both] [--dry-run]
//
// The script stamps each selected package with:
//   - version: `1.0.<current epoch seconds>` (unique, monotonic; the value itself is meaningless)
//   - dependencies.eas-cli: the exact version passed via --eas-cli-version (the payload)
// and runs `npm publish` in the package directory. In CI, authentication uses
// npm OIDC trusted publishing (requires npm >= 11.5.1 and `id-token: write`).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const POINTER_PACKAGE_NAME_BY_TARGET = {
  staging: 'eas-cli-for-eas-build-staging',
  production: 'eas-cli-for-eas-build',
};
const VALID_TARGETS = ['staging', 'production', 'both'];
const EXISTENCE_CHECK_ATTEMPTS = 5;
const EXISTENCE_CHECK_DELAY_MS = 15_000;

function parseArgs(argv) {
  let easCliVersion;
  let target = 'both';
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--eas-cli-version') {
      easCliVersion = argv[++i];
    } else if (arg === '--target') {
      target = argv[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!easCliVersion || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(easCliVersion)) {
    throw new Error(
      `--eas-cli-version is required and must be an exact version, got: ${easCliVersion ?? '(missing)'}`
    );
  }
  if (!VALID_TARGETS.includes(target)) {
    throw new Error(`--target must be one of ${VALID_TARGETS.join(', ')}, got: ${target}`);
  }

  return { easCliVersion, target, dryRun };
}

async function assertEasCliVersionExistsAsync(easCliVersion) {
  for (let attempt = 1; attempt <= EXISTENCE_CHECK_ATTEMPTS; attempt++) {
    try {
      const output = execFileSync('npm', ['view', `eas-cli@${easCliVersion}`, 'version'], {
        encoding: 'utf8',
      }).trim();
      if (output === easCliVersion) {
        console.log(`Resolved eas-cli@${easCliVersion} on the registry.`);
        return;
      }
      throw new Error(`Registry returned unexpected version: ${output}`);
    } catch (err) {
      if (attempt === EXISTENCE_CHECK_ATTEMPTS) {
        throw new Error(
          `eas-cli@${easCliVersion} was not found on the registry after ${EXISTENCE_CHECK_ATTEMPTS} attempts: ${err.message}`
        );
      }
      console.log(
        `eas-cli@${easCliVersion} is not visible on the registry yet (attempt ${attempt}/${EXISTENCE_CHECK_ATTEMPTS}). Retrying in ${EXISTENCE_CHECK_DELAY_MS / 1000}s...`
      );
      await sleep(EXISTENCE_CHECK_DELAY_MS);
    }
  }
}

function publishPointerPackage({ packageName, easCliVersion, dryRun }) {
  const packageDir = path.join(path.dirname(fileURLToPath(import.meta.url)), packageName);
  const packageJsonPath = path.join(packageDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  packageJson.version = `1.0.${Math.floor(Date.now() / 1000)}`;
  packageJson.dependencies['eas-cli'] = easCliVersion;
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  console.log(
    `Publishing ${packageName}@${packageJson.version} (pins eas-cli@${easCliVersion})${dryRun ? ' [dry run]' : ''}...`
  );
  execFileSync('npm', ['publish', ...(dryRun ? ['--dry-run'] : [])], {
    cwd: packageDir,
    stdio: 'inherit',
  });
}

const { easCliVersion, target, dryRun } = parseArgs(process.argv.slice(2));
await assertEasCliVersionExistsAsync(easCliVersion);

// Publish staging first so a failure never leaves production ahead of staging.
const targets = target === 'both' ? ['staging', 'production'] : [target];
for (const t of targets) {
  publishPointerPackage({
    packageName: POINTER_PACKAGE_NAME_BY_TARGET[t],
    easCliVersion,
    dryRun,
  });
}
console.log('Done.');
