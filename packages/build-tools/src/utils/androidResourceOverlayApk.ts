import { bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import path from 'node:path';

import { type AndroidResourceOverlayValue } from './androidEmulatorDeviceProfileCorrections';

/**
 * Builds a signed runtime resource overlay (RRO) APK with the Android SDK's aapt2, zipalign, and
 * apksigner. The overlay has no code; it only replaces resource values of `targetPackage`.
 */
export async function buildAndroidResourceOverlayApkAsync({
  packageName,
  targetPackage,
  category,
  values,
  workingDirectory,
  env,
  logger,
}: {
  packageName: string;
  targetPackage: string;
  category: string;
  values: AndroidResourceOverlayValue[];
  workingDirectory: string;
  env: NodeJS.ProcessEnv;
  logger: bunyan;
}): Promise<string> {
  const androidHome = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (!androidHome) {
    throw new Error('ANDROID_HOME is not set.');
  }
  const buildToolsDirectory = await findLatestBuildToolsDirectoryAsync(androidHome);
  const { androidJar, apiLevel } = await findLatestPlatformAsync(androidHome);
  logger.debug(`Building ${packageName} with ${buildToolsDirectory} and ${androidJar}.`);

  const projectDirectory = path.join(workingDirectory, packageName);
  const valuesDirectory = path.join(projectDirectory, 'res', 'values');
  await fs.promises.mkdir(valuesDirectory, { recursive: true });
  const manifestPath = path.join(projectDirectory, 'AndroidManifest.xml');
  await fs.promises.writeFile(
    manifestPath,
    createOverlayManifest({ packageName, targetPackage, category })
  );
  await fs.promises.writeFile(path.join(valuesDirectory, 'values.xml'), createValuesXml(values));

  const compiledResources = path.join(projectDirectory, 'resources.zip');
  const unsignedApk = path.join(projectDirectory, 'unsigned.apk');
  const alignedApk = path.join(projectDirectory, 'aligned.apk');
  const signedApk = path.join(workingDirectory, `${packageName}.apk`);
  const keystore = path.join(workingDirectory, 'overlay-signing.keystore');
  const keystorePassword = 'android';

  await spawn(
    path.join(buildToolsDirectory, 'aapt2'),
    ['compile', '--dir', path.join(projectDirectory, 'res'), '-o', compiledResources],
    { env }
  );
  await spawn(
    path.join(buildToolsDirectory, 'aapt2'),
    [
      'link',
      '-o',
      unsignedApk,
      '--manifest',
      manifestPath,
      '-I',
      androidJar,
      // Overlays need Android 10 (API 29) or newer.
      '--min-sdk-version',
      '29',
      '--target-sdk-version',
      apiLevel,
      compiledResources,
    ],
    { env }
  );
  await spawn(path.join(buildToolsDirectory, 'zipalign'), ['-f', '4', unsignedApk, alignedApk], {
    env,
  });
  if (!fs.existsSync(keystore)) {
    // The system only checks that an overlay in /product is signed, not by whom.
    await spawn(
      env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', 'keytool') : 'keytool',
      [
        '-genkeypair',
        '-keystore',
        keystore,
        '-alias',
        'overlay',
        '-keyalg',
        'RSA',
        '-keysize',
        '2048',
        '-validity',
        '1',
        '-storepass',
        keystorePassword,
        '-keypass',
        keystorePassword,
        '-dname',
        'CN=EAS emulator overlay',
      ],
      { env }
    );
  }
  await spawn(
    path.join(buildToolsDirectory, 'apksigner'),
    [
      'sign',
      '--ks',
      keystore,
      '--ks-pass',
      `pass:${keystorePassword}`,
      '--out',
      signedApk,
      alignedApk,
    ],
    { env }
  );
  return signedApk;
}

export function createOverlayManifest({
  packageName,
  targetPackage,
  category,
}: {
  packageName: string;
  targetPackage: string;
  category: string;
}): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${escapeXml(packageName)}">`,
    '    <application android:hasCode="false" />',
    `    <overlay android:targetPackage="${escapeXml(targetPackage)}" android:category="${escapeXml(category)}" />`,
    '</manifest>',
    '',
  ].join('\n');
}

export function createValuesXml(values: AndroidResourceOverlayValue[]): string {
  const items = values.map(({ type, name, value }) =>
    type === 'string'
      ? `    <string name="${escapeXml(name)}" translatable="false">${escapeAndroidString(value)}</string>`
      : `    <dimen name="${escapeXml(name)}">${escapeXml(value)}</dimen>`
  );
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<resources>',
    ...items,
    '</resources>',
    '',
  ].join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Android string resources also treat quotes, apostrophes, and a leading @ or ? specially. */
function escapeAndroidString(value: string): string {
  return escapeXml(value.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))
    .replace(/&quot;/g, '\\"')
    .replace(/^([@?])/, '\\$1');
}

async function findLatestBuildToolsDirectoryAsync(androidHome: string): Promise<string> {
  const buildToolsRoot = path.join(androidHome, 'build-tools');
  const versions = (await readDirectoryNamesAsync(buildToolsRoot)).filter(version =>
    fs.existsSync(path.join(buildToolsRoot, version, 'aapt2'))
  );
  const latest = versions.sort(compareVersionsDescending)[0];
  if (!latest) {
    throw new Error(`No Android build tools with aapt2 in ${buildToolsRoot}.`);
  }
  return path.join(buildToolsRoot, latest);
}

async function findLatestPlatformAsync(
  androidHome: string
): Promise<{ androidJar: string; apiLevel: string }> {
  const platformsRoot = path.join(androidHome, 'platforms');
  const platforms = (await readDirectoryNamesAsync(platformsRoot)).filter(platform =>
    fs.existsSync(path.join(platformsRoot, platform, 'android.jar'))
  );
  const latest = platforms.sort((a, b) =>
    compareVersionsDescending(a.replace(/^android-/, ''), b.replace(/^android-/, ''))
  )[0];
  const apiLevel = latest?.match(/^android-(\d+)/)?.[1];
  if (!latest || !apiLevel) {
    throw new Error(`No Android platform with android.jar in ${platformsRoot}.`);
  }
  return { androidJar: path.join(platformsRoot, latest, 'android.jar'), apiLevel };
}

async function readDirectoryNamesAsync(directory: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(directory);
  } catch {
    return [];
  }
}

/** Sorts `36.1.0` before `36.0.0` and `36` before `35.1`; names without numbers go last. */
export function compareVersionsDescending(a: string, b: string): number {
  const partsA = a.split(/[.-]/).map(part => Number.parseInt(part, 10));
  const partsB = b.split(/[.-]/).map(part => Number.parseInt(part, 10));
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = Number.isNaN(partsA[i]) ? -1 : (partsA[i] ?? 0);
    const partB = Number.isNaN(partsB[i]) ? -1 : (partsB[i] ?? 0);
    if (partA !== partB) {
      return partB - partA;
    }
  }
  return 0;
}
