import os from 'os';
import path from 'path';

import { v4 as uuidv4 } from 'uuid';
import { BuildContext } from '@expo/build-tools';
import { errors, Job } from '@expo/eas-build-job';
import templateFile from '@expo/template-file';
import spawn from '@expo/turtle-spawn';
import fs from 'fs-extra';

import config from './config';

class SystemDepsInstallError extends errors.UserFacingError {
  constructor(dependency: string) {
    super(
      'EAS_BUILD_SYSTEM_DEPS_INSTALL_ERROR',
      `Failed to install ${dependency}. Make sure you specified the correct version in eas.json.`
    );
  }
}

export async function prepareRuntimeEnvironmentConfigFiles(): Promise<void> {
  if (config.env === 'development' || config.env === 'test') {
    return;
  }

  if (config.npmCacheUrl) {
    // create ~/.npmrc
    await spawn('npm', ['config', 'set', 'registry', config.npmCacheUrl]);
    // create ~/.yarnrc.yml
    await templateFile(
      path.join(__dirname, '../src/templates/yarnrc.yml'),
      {
        URL: config.npmCacheUrl,
      },
      path.join(os.homedir(), '.yarnrc.yml')
    );
  }

  if (config.mavenCacheUrl) {
    await fs.mkdirp(path.join(os.homedir(), '.gradle'));
    await templateFile(
      path.join(__dirname, '../src/templates/init.gradle'),
      {
        URL: config.mavenCacheUrl,
      },
      path.join(os.homedir(), '.gradle/init.gradle')
    );
  }
}

// At this step we don't yet have the code downloaded, so `packageManager` defaults to `yarn`
// and so should not be used for any logic
type PreDownloadBuildContext = Omit<BuildContext<Job>, 'packageManager'>;

export async function prepareRuntimeEnvironment(
  ctx: PreDownloadBuildContext,
  builderConfig: Job['builderEnvironment'],
  skipIfTest = true
): Promise<void> {
  if (skipIfTest && (config.env === 'development' || config.env === 'test')) {
    ctx.logger.warn(
      'Runtime environment customizations are disabled in local and test environments'
    );
    return;
  }

  if (process.platform === 'darwin') {
    await installCocoapodsCachePlugin();
  }

  if (!builderConfig) {
    return;
  }

  const currentYarnVersion = (await spawn('yarn', ['--version'], { stdio: 'pipe' })).stdout.trim();
  const currentPnpmVersion = (await spawn('pnpm', ['--version'], { stdio: 'pipe' })).stdout.trim();
  const currentBunVersion = (await spawn('bun', ['--version'], { stdio: 'pipe' })).stdout.trim();

  if (builderConfig.node) {
    const installedNodeVersion = await installNode(ctx, builderConfig.node);
    await installSharpCli(ctx, installedNodeVersion);
  }
  if (builderConfig.corepack) {
    ctx.logger.info(`Enabling corepack`);
    await spawn('corepack', ['enable'], { logger: ctx.logger, env: ctx.env });
  }
  if (
    Boolean(builderConfig.pnpm && currentPnpmVersion !== builderConfig.pnpm) ||
    builderConfig.node
  ) {
    await installPnpm({
      ctx,
      userSpecifiedVersion: builderConfig.pnpm,
      currentVersion: currentPnpmVersion,
    });
  }
  if (
    Boolean(builderConfig.yarn && currentYarnVersion !== builderConfig.yarn) ||
    builderConfig.node
  ) {
    await installYarn({
      ctx,
      userSpecifiedVersion: builderConfig.yarn,
      currentVersion: currentYarnVersion,
    });
  }
  if (builderConfig.bun && currentBunVersion !== builderConfig.bun) {
    await installBun({
      ctx,
      userSpecifiedVersion: builderConfig.bun,
      currentVersion: currentBunVersion,
    });
  }
  if ('ndk' in builderConfig && builderConfig.ndk) {
    await installNdk(ctx, builderConfig.ndk);
  }
  if ('bundler' in builderConfig && builderConfig.bundler) {
    await installBundler(ctx, builderConfig.bundler);
  }
  if ('fastlane' in builderConfig && builderConfig.fastlane) {
    await installFastlane(ctx, builderConfig.fastlane);
  }
  if ('cocoapods' in builderConfig && builderConfig.cocoapods) {
    await installCocoapods(ctx, builderConfig.cocoapods);
  }
}

async function installNode(ctx: PreDownloadBuildContext, version: string): Promise<string> {
  let sanitizedVersion = version.startsWith('v') ? version.slice(1) : version;
  try {
    ctx.logger.info(`Installing node v${sanitizedVersion}`);
    const { stdout } = await spawn(
      'bash',
      ['-c', `source ~/.nvm/nvm.sh && nvm install ${version}`],
      {
        logger: ctx.logger,
        env: ctx.env,
      }
    );

    sanitizedVersion = stdout.match(/Now using node v(\d+\.\d+\.\d+)/)?.[1] ?? sanitizedVersion;
    await spawn('bash', ['-c', `source ~/.nvm/nvm.sh && nvm alias default ${sanitizedVersion}`], {
      logger: ctx.logger,
      env: ctx.env,
    });
    const nodeDir = `${os.homedir()}/.nvm/versions/node/v${sanitizedVersion}`;
    ctx.env.PATH = `${nodeDir}/bin:${ctx.env.PATH}`;
    const nodeBinPath = `${nodeDir}/bin/node`;
    if (!(await fs.pathExists(nodeBinPath))) {
      throw new Error(`node executable was not found in ${nodeBinPath}`);
    }
  } catch (err: any) {
    ctx.logger.error({ err }, `Failed to install Node.js v${version}\n`);
    throw new SystemDepsInstallError('Node.js');
  }
  return sanitizedVersion;
}

async function installBundler(ctx: PreDownloadBuildContext, version: string): Promise<void> {
  try {
    ctx.logger.info(`Installing bundler ${version}`);
    await spawn(
      'sudo',
      ['-E', 'gem', 'install', '--no-document', '--quiet', 'bundler', '-v', version],
      {
        logger: ctx.logger,
        env: ctx.env,
      }
    );
  } catch (err: any) {
    ctx.logger.error({ err }, `Failed to install bundler ${version}\n`);
    throw new SystemDepsInstallError('bundler');
  }
}

async function installBun({
  ctx,
  userSpecifiedVersion,
  currentVersion,
}: {
  ctx: PreDownloadBuildContext;
  userSpecifiedVersion: string | undefined;
  currentVersion: string;
}): Promise<void> {
  const versionToInstall = userSpecifiedVersion ?? currentVersion;
  try {
    ctx.logger.info(`Installing bun@${versionToInstall}`);

    const bunInstallScriptPath = path.join(os.tmpdir(), `install-bun-${uuidv4()}.sh`);

    await spawn('curl', ['-fsSL', 'https://bun.sh/install', '-o', bunInstallScriptPath], {
      logger: ctx.logger,
      env: ctx.env,
    });

    await spawn('bash', [bunInstallScriptPath, `bun-v${versionToInstall}`], {
      logger: ctx.logger,
      env: ctx.env,
    });

    await spawn('rm', [bunInstallScriptPath], {
      logger: ctx.logger,
      env: ctx.env,
    });

    const currentBunVersion = (
      await spawn('bun', ['--version'], { stdio: 'pipe', env: ctx.env })
    ).stdout.trim();
    if (currentBunVersion !== versionToInstall) {
      throw new Error(
        `Found wrong bun version ${currentBunVersion} (expected ${versionToInstall})`
      );
    }
  } catch (err: any) {
    ctx.logger.error({ err }, `Failed to install Bun ${versionToInstall}\n`);
    if (ctx.metadata?.requiredPackageManager === 'bun') {
      throw new SystemDepsInstallError('bun');
    } else {
      ctx.markBuildPhaseHasWarnings();
      ctx.logger.warn(
        `Failed to install bun@${versionToInstall}. Continuing because Bun is not the primary package manager for this project.`
      );
    }
  }
}

async function installPnpm({
  ctx,
  userSpecifiedVersion,
  currentVersion,
}: {
  ctx: PreDownloadBuildContext;
  userSpecifiedVersion: string | undefined;
  currentVersion: string;
}): Promise<void> {
  const versionToInstall = userSpecifiedVersion ?? currentVersion;
  try {
    ctx.logger.info(`Installing pnpm@${versionToInstall}`);

    await spawn('npm', ['-g', 'install', `pnpm@${versionToInstall}`], {
      logger: ctx.logger,
      env: ctx.env,
    });
    const currentPnpmVersion = (
      await spawn('pnpm', ['--version'], { stdio: 'pipe', env: ctx.env })
    ).stdout.trim();
    if (currentPnpmVersion !== versionToInstall) {
      throw new Error(
        `Found wrong pnpm version ${currentPnpmVersion} (expected ${versionToInstall})`
      );
    }
  } catch (err: any) {
    ctx.logger.error({ err }, `Failed to install pnpm ${versionToInstall}\n`);
    if (ctx.metadata?.requiredPackageManager === 'pnpm') {
      throw new SystemDepsInstallError('pnpm');
    } else {
      ctx.markBuildPhaseHasWarnings();
      ctx.logger.warn(
        `Failed to install pnpm@${versionToInstall}. Continuing because pnpm is not the primary package manager for this project.`
      );
    }
  }
}

async function installYarn({
  ctx,
  userSpecifiedVersion,
  currentVersion,
}: {
  ctx: PreDownloadBuildContext;
  userSpecifiedVersion: string | undefined;
  currentVersion: string;
}): Promise<void> {
  const versionToInstall = userSpecifiedVersion ?? currentVersion;
  try {
    ctx.logger.info(`Installing yarn@${versionToInstall}`);
    await spawn('npm', ['-g', 'install', `yarn@${versionToInstall}`], {
      logger: ctx.logger,
      env: ctx.env,
    });
    const currentYarnVersion = (
      await spawn('yarn', ['--version'], { stdio: 'pipe', env: ctx.env })
    ).stdout.trim();
    if (currentYarnVersion !== versionToInstall) {
      throw new Error(
        `Found wrong yarn version ${currentYarnVersion} (expected ${versionToInstall})`
      );
    }
  } catch (err: any) {
    ctx.logger.error({ err }, `Failed to install Yarn ${versionToInstall}\n`);
    if (ctx.metadata?.requiredPackageManager === 'yarn') {
      throw new SystemDepsInstallError('yarn');
    } else {
      ctx.markBuildPhaseHasWarnings();
      ctx.logger.warn(
        `Failed to install yarn@${versionToInstall}. Continuing because yarn is not the primary package manager for this project.`
      );
    }
  }
}

async function installSharpCli(ctx: PreDownloadBuildContext, nodeVersion: string): Promise<void> {
  const sharpCliVersion = (await spawn('sharp', ['--version'], { stdio: 'pipe' })).stdout.trim();
  try {
    await spawn('npm', ['-g', 'install', `sharp-cli@${sharpCliVersion}`], {
      logger: ctx.logger,
      env: ctx.env,
    });
  } catch (err: any) {
    ctx.logger.warn(
      { err },
      `Failed to install sharp-cli@${sharpCliVersion} for Node.js v${nodeVersion}`
    );
    ctx.logger.warn(
      `If your version of Node.js does not support ${sharpCliVersion} version of sharp-cli`
    );
    ctx.logger.warn(` - build will fallback to slower (JS only) implementation.`);
    ctx.logger.warn(
      ` - you can install different version in "eas-build-pre-install" hook (https://docs.expo.dev/build-reference/how-tos/#eas-build-specific-npm-hooks)`
    );
  }
}

async function installFastlane(ctx: PreDownloadBuildContext, version: string): Promise<void> {
  try {
    ctx.logger.info(`Installing fastlane ${version}`);
    await spawn('sudo', ['-E', 'gem', 'uninstall', '--quiet', 'fastlane'], { logger: ctx.logger });
    await spawn(
      'sudo',
      ['-E', 'gem', 'install', '--no-document', '--quiet', 'fastlane', '-v', version],
      {
        logger: ctx.logger,
        env: ctx.env,
      }
    );
  } catch (err: any) {
    ctx.logger.error({ err }, `Failed to install fastlane ${version}\n`);
    throw new SystemDepsInstallError('fastlane');
  }
}

async function installCocoapods(ctx: PreDownloadBuildContext, version: string): Promise<void> {
  try {
    ctx.logger.info(`Installing CocoaPods ${version}`);
    await spawn('sudo', ['-E', 'gem', 'uninstall', '--quiet', 'cocoapods'], { logger: ctx.logger });
    await spawn(
      'sudo',
      ['-E', 'gem', 'install', '--no-document', '--quiet', 'cocoapods', '-v', version],
      {
        logger: ctx.logger,
        env: ctx.env,
      }
    );
  } catch (err: any) {
    ctx.logger.error({ err }, `Failed to install CocoaPods ${version}\n`);
    throw new SystemDepsInstallError('CocoaPods');
  }
}

async function installNdk(ctx: PreDownloadBuildContext, version: string): Promise<void> {
  try {
    ctx.logger.info(`Installing NDK ${version}`);
    await spawn('sdkmanager', [`ndk;${version}`], { env: ctx.env });
    const ndkHome = `${ctx.env.ANDROID_HOME}/ndk/${version}`;
    ctx.env.ANDROID_NDK_HOME = ndkHome;
    if (!(await fs.pathExists(ndkHome))) {
      throw new Error(`NDK was not found under ${ndkHome}`);
    }
  } catch (err: any) {
    ctx.logger.error({ err }, `Failed to install NDK ${version}\n`);
    throw new SystemDepsInstallError('NDK');
  }
}

async function installCocoapodsCachePlugin(): Promise<void> {
  try {
    await spawn('sudo', [
      '-E',
      'gem',
      'install',
      '--quiet',
      path.join(__dirname, '../expo-cocoapods-proxy.gem'),
    ]);
  } catch {
    throw new Error('Failed to install expo-cocoapods-proxy');
  }
}
