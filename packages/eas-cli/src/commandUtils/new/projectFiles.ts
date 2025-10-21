import { ExpoConfig } from '@expo/config';
import { AppVersionSource, EasJson } from '@expo/eas-json';
import fs from 'fs-extra';
import path from 'path';
import merge from 'ts-deepmerge';

import { getEASUpdateURL } from '../../api';
import { AppFragment } from '../../graphql/generated';
import { PackageManager } from '../../onboarding/installDependencies';
import { easCliVersion } from '../../utils/easCli';

// Android package names must start with a lowercase letter
// schemes must start with a lowercase letter and can only contain lowercase letters, digits, "+", "." or "-"
export function cleanAndPrefix(_string: string, type: 'user' | 'app' | 'scheme'): string {
  let string = _string;
  let pattern = /[^A-Za-z0-9]/g;
  if (type === 'scheme') {
    string = _string.toLowerCase();
    pattern = /[^a-z0-9+.-]/g;
  }

  const prefix = /^[^a-z]/.test(string) ? type : '';
  const cleaned = string.replaceAll(pattern, '');

  return prefix + cleaned;
}

export async function generateAppConfigAsync(projectDir: string, app: AppFragment): Promise<void> {
  const user = cleanAndPrefix(app.ownerAccount.name, 'user');
  const slug = cleanAndPrefix(app.slug, 'app');
  const scheme = cleanAndPrefix(app.name ?? app.slug, 'scheme');

  const bundleIdentifier = `com.${user}.${slug}`;
  const updateUrl = getEASUpdateURL(app.id, /* manifestHostOverride */ null);

  const { expo: baseExpoConfig } = await fs.readJson(path.join(projectDir, 'app.json'));
  const expoConfig: ExpoConfig = {
    name: app.name ?? app.slug,
    slug: app.slug,
    scheme,
    extra: {
      eas: {
        projectId: app.id,
      },
    },
    owner: app.ownerAccount.name,
    updates: {
      url: updateUrl,
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    ios: {
      bundleIdentifier,
    },
    android: {
      package: bundleIdentifier,
    },
  };
  const mergedConfig = merge(baseExpoConfig, expoConfig);

  const appJsonPath = path.join(projectDir, 'app.json');
  await fs.writeJson(appJsonPath, { expo: mergedConfig }, { spaces: 2 });
}

export async function generateEasConfigAsync(projectDir: string): Promise<void> {
  const easBuildGitHubConfig = {
    android: {
      image: 'latest',
    },
    ios: {
      image: 'latest',
    },
  };

  const easJson: EasJson = {
    cli: {
      version: `>= ${easCliVersion}`,
      appVersionSource: AppVersionSource.REMOTE,
    },
    build: {
      development: {
        developmentClient: true,
        distribution: 'internal',
        ...easBuildGitHubConfig,
      },
      'development-simulator': {
        extends: 'development',
        ios: {
          simulator: true,
        },
      },
      preview: {
        distribution: 'internal',
        channel: 'main',
        ...easBuildGitHubConfig,
      },
      production: {
        channel: 'production',
        autoIncrement: true,
        ...easBuildGitHubConfig,
      },
    },
    submit: {
      production: {},
    },
  };

  const easJsonPath = path.join(projectDir, 'eas.json');
  await fs.writeJson(easJsonPath, easJson, { spaces: 2 });
}

export async function updatePackageJsonAsync(projectDir: string): Promise<void> {
  const packageJsonPath = path.join(projectDir, 'package.json');
  const packageJson = await fs.readJson(packageJsonPath);

  if (!packageJson.scripts) {
    packageJson.scripts = {};
  }
  packageJson.scripts.draft = 'npx eas-cli@latest workflow:run create-draft.yml';
  packageJson.scripts['development-builds'] =
    'npx eas-cli@latest workflow:run create-development-builds.yml';
  packageJson.scripts.deploy = 'npx eas-cli@latest workflow:run deploy-to-production.yml';

  await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
}

export async function copyProjectTemplatesAsync(projectDir: string): Promise<void> {
  const templatesSourceDir = path.join(__dirname, 'templates');

  // Copy everything from templates to projectDir, skipping readme-additions.md
  await fs.copy(templatesSourceDir, projectDir, {
    overwrite: true,
    errorOnExist: false,
    filter: (src: string) => {
      return !src.endsWith('readme-additions.md');
    },
  });

  const agentsPath = path.join(projectDir, 'AGENTS.md');
  ['cursorrules', 'clinerules'].forEach(async rule => {
    await fs.symlink(agentsPath, path.join(projectDir, `.${rule}`));
  });
}

export async function updateReadmeAsync(
  projectDir: string,
  packageManager: PackageManager
): Promise<void> {
  const readmeTemplatePath = path.join(__dirname, 'templates', 'readme-additions.md');
  const projectReadmePath = path.join(projectDir, 'README.md');

  const readmeAdditions = await fs.readFile(readmeTemplatePath, 'utf8');
  const existingReadme = await fs.readFile(projectReadmePath, 'utf8');

  const targetSection = '## Get started';
  const sectionIndex = existingReadme.indexOf(targetSection);

  let mergedReadme: string;
  if (sectionIndex !== -1) {
    // Find the next ## section after "## Get started"
    const afterTargetSection = existingReadme.substring(sectionIndex);
    const nextSectionMatch = afterTargetSection.match(/\n## /);
    let endIndex = existingReadme.length;
    if (nextSectionMatch?.index !== undefined) {
      // Replace from "## Get started" to the next "##" section
      endIndex = sectionIndex + nextSectionMatch.index;
    }

    const beforeSection = existingReadme.substring(0, sectionIndex).trim();
    const afterSection = existingReadme.substring(endIndex);
    mergedReadme = beforeSection + '\n\n' + readmeAdditions.trim() + '\n\n' + afterSection;
  } else {
    // No "Get started" section found, append the template to the existing README
    mergedReadme = existingReadme.trim() + '\n\n' + readmeAdditions.trim();
  }

  mergedReadme = mergedReadme.replaceAll('npm run', `${packageManager} run`);

  await fs.writeFile(projectReadmePath, mergedReadme);
}
