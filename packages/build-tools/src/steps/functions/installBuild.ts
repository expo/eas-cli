import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export function createInstallBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'install_build',
    name: 'Install build',
    __metricsId: 'eas/install_build',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'artifact_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'application_identifier',
        required: true,
      }),
      BuildStepOutput.createProvider({
        id: 'activity_name',
        required: false,
      }),
    ],
    fn: async ({ global, logger }, { inputs, outputs, env }) => {
      const artifactPath = z.string().min(1).parse(inputs.artifact_path.value);
      const { applicationIdentifier, activityName } = await installBuildAsync({
        artifactPath,
        runtimePlatform: global.runtimePlatform,
        env,
        logger,
      });
      outputs.application_identifier.set(applicationIdentifier);
      if (activityName) {
        outputs.activity_name.set(activityName);
      }
    },
  });
}

export async function installBuildAsync({
  artifactPath,
  runtimePlatform,
  env,
  logger,
}: {
  artifactPath: string;
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<{ applicationIdentifier: string; activityName?: string }> {
  const artifactStat = await fs.promises.stat(artifactPath).catch(err => {
    throw new UserError(
      'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
      `Build artifact does not exist at ${artifactPath}.`,
      { cause: err }
    );
  });

  if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
    if (path.extname(artifactPath) !== '.app' || !artifactStat.isDirectory()) {
      throw new UserError(
        'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
        'iOS Simulator sessions require a .app build artifact.'
      );
    }

    const infoPlistPath = path.join(artifactPath, 'Info.plist');
    const { stdout } = await spawn(
      'plutil',
      ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', infoPlistPath],
      { stdio: 'pipe', env }
    );
    const applicationIdentifier = stdout.trim();
    if (!applicationIdentifier) {
      throw new UserError(
        'EAS_INSTALL_BUILD_MISSING_IDENTIFIER',
        `Could not read CFBundleIdentifier from ${infoPlistPath}.`
      );
    }

    logger.info(`Installing ${artifactPath} on the iOS Simulator.`);
    await spawn('xcrun', ['simctl', 'install', 'booted', artifactPath], { env, logger });
    return { applicationIdentifier };
  }

  if (path.extname(artifactPath).toLowerCase() !== '.apk' || !artifactStat.isFile()) {
    throw new UserError(
      'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
      'Android Emulator sessions require an .apk build artifact.'
    );
  }

  let stdout: string;
  try {
    ({ stdout } = await spawn('aapt2', ['dump', 'badging', artifactPath], {
      stdio: 'pipe',
      env,
    }));
  } catch (err) {
    if (isAapt2NonZeroExitError(err) && (await isReadableFileAsync(artifactPath))) {
      const stderrDetails = formatAapt2Stderr(err.stderr);
      const baseMessage =
        `The build artifact (${path.basename(artifactPath)}) is not a valid Android .apk. ` +
        'Android Emulator sessions require a valid .apk build artifact (not an .aab, HTML page, or archive download).';
      throw new UserError(
        'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
        stderrDetails ? `${baseMessage} aapt2 stderr: ${stderrDetails}` : baseMessage,
        { cause: err }
      );
    }
    throw err;
  }
  const applicationIdentifier = stdout.match(/package: name='([^']+)'/)?.[1];
  const activityName = stdout.match(/launchable-activity: name='([^']+)'/)?.[1];
  if (!applicationIdentifier) {
    throw new UserError(
      'EAS_INSTALL_BUILD_MISSING_IDENTIFIER',
      `Could not read an Android application identifier from ${artifactPath}.`
    );
  }

  logger.info(`Installing ${artifactPath} on the Android Emulator.`);
  await spawn('adb', ['install', '-r', artifactPath], { env, logger });
  return { applicationIdentifier, activityName };
}

const MAX_AAPT2_STDERR_LENGTH = 500;

type SpawnExitError = {
  status: number;
  signal?: string | null;
  code?: string;
  stderr?: string | Buffer;
};

function isAapt2NonZeroExitError(err: unknown): err is SpawnExitError {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const candidate = err as Record<string, unknown>;
  if (typeof candidate.code === 'string' && candidate.code.length > 0) {
    return false;
  }
  if (candidate.signal != null) {
    return false;
  }
  return typeof candidate.status === 'number' && candidate.status > 0 && candidate.status < 126;
}

async function isReadableFileAsync(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function formatAapt2Stderr(stderr: string | Buffer | undefined): string | undefined {
  if (stderr === undefined) {
    return undefined;
  }
  const text = (typeof stderr === 'string' ? stderr : stderr.toString('utf8')).trim();
  if (!text) {
    return undefined;
  }
  if (text.length <= MAX_AAPT2_STDERR_LENGTH) {
    return text;
  }
  return `…${text.slice(-(MAX_AAPT2_STDERR_LENGTH - 1))}`;
}
