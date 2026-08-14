import { bunyan } from '@expo/logger';
import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

const PREWARM_TIMEOUT_MS = 5 * 60 * 1000;

const STORYBOARD = `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="24093.7" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" colorMatched="YES" initialViewController="view-controller">
    <device id="retina6_12" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="24053.1"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <scene sceneID="scene">
            <objects>
                <viewController id="view-controller" sceneMemberID="viewController">
                    <view key="view" contentMode="scaleToFill" id="view">
                        <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
                        <autoresizingMask key="autoresizingMask" flexibleMaxX="YES" flexibleMaxY="YES"/>
                        <color key="backgroundColor" red="1" green="1" blue="1" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="first-responder" sceneMemberID="firstResponder"/>
            </objects>
        </scene>
    </scenes>
</document>`;

const ASSET_CATALOG_CONTENTS = JSON.stringify({
  info: { author: 'expo', version: 1 },
});

const IMAGE_SET_CONTENTS = JSON.stringify({
  images: [{ filename: 'Warmup.png', idiom: 'universal', scale: '1x' }],
  info: { author: 'expo', version: 1 },
});

const WARMUP_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLkWQAAAABJRU5ErkJggg==',
  'base64'
);

const COLOR_SET_CONTENTS = JSON.stringify({
  colors: [
    {
      color: {
        'color-space': 'srgb',
        components: { alpha: '1.000', blue: '1.000', green: '1.000', red: '1.000' },
      },
      idiom: 'universal',
    },
  ],
  info: { author: 'expo', version: 1 },
});

let prewarmPromise: Promise<void> | undefined;

export function startXcodeBuildToolsPrewarming({
  env,
  logger,
}: {
  env: NodeJS.ProcessEnv;
  logger: bunyan;
}): Promise<void> {
  if (process.platform !== 'darwin' || !logger) {
    return Promise.resolve();
  }

  prewarmPromise ??= prewarmXcodeBuildToolsAsync({ env, logger }).catch((error: any) => {
    logger.warn({ err: error }, 'Xcode build tool prewarming failed; continuing the build.');
  });
  return prewarmPromise;
}

async function prewarmXcodeBuildToolsAsync({
  env,
  logger,
}: {
  env: NodeJS.ProcessEnv;
  logger: bunyan;
}): Promise<void> {
  const startedAt = Date.now();
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'eas-xcode-build-tool-prewarm-')
  );

  try {
    const storyboardPath = path.join(temporaryDirectory, 'Warmup.storyboard');
    const storyboardOutputPath = path.join(temporaryDirectory, 'storyboard-output');
    const assetCatalogPath = path.join(temporaryDirectory, 'Warmup.xcassets');
    const colorSetPath = path.join(assetCatalogPath, 'Warmup.colorset');
    const imageSetPath = path.join(assetCatalogPath, 'Warmup.imageset');
    const assetCatalogOutputPath = path.join(temporaryDirectory, 'asset-catalog-output');

    await Promise.all([
      fs.outputFile(storyboardPath, STORYBOARD),
      fs.outputFile(path.join(assetCatalogPath, 'Contents.json'), ASSET_CATALOG_CONTENTS),
      fs.outputFile(path.join(colorSetPath, 'Contents.json'), COLOR_SET_CONTENTS),
      fs.outputFile(path.join(imageSetPath, 'Contents.json'), IMAGE_SET_CONTENTS),
      fs.outputFile(path.join(imageSetPath, 'Warmup.png'), WARMUP_IMAGE),
      fs.ensureDir(storyboardOutputPath),
      fs.ensureDir(assetCatalogOutputPath),
    ]);

    logger.info('Prewarming Xcode interface and asset build tools in the background.');

    const results = await Promise.allSettled([
      spawnWithTimeout(
        'xcrun',
        [
          'ibtool',
          '--errors',
          '--warnings',
          '--notices',
          '--target-device',
          'iphone',
          '--target-device',
          'ipad',
          '--minimum-deployment-target',
          '12.0',
          '--output-format',
          'human-readable-text',
          storyboardPath,
          '--compilation-directory',
          storyboardOutputPath,
        ],
        { env }
      ),
      spawnWithTimeout(
        'xcrun',
        [
          'actool',
          assetCatalogPath,
          '--compile',
          assetCatalogOutputPath,
          '--output-format',
          'human-readable-text',
          '--notices',
          '--warnings',
          '--platform',
          'iphonesimulator',
          '--minimum-deployment-target',
          '12.0',
          '--target-device',
          'iphone',
          '--target-device',
          'ipad',
        ],
        { env }
      ),
    ]);

    const failedResults = results.filter(result => result.status === 'rejected');
    if (failedResults.length > 0) {
      logger.warn(
        { errors: failedResults.map(result => result.reason) },
        'Some Xcode build tools could not be prewarmed; continuing the build.'
      );
    } else {
      logger.info(
        `Xcode interface and asset build tools were prewarmed in ${(
          (Date.now() - startedAt) /
          1000
        ).toFixed(1)} seconds.`
      );
    }
  } finally {
    await fs.remove(temporaryDirectory);
  }
}

async function spawnWithTimeout(
  command: string,
  args: string[],
  { env }: { env: NodeJS.ProcessEnv }
): Promise<SpawnResult> {
  const spawnPromise: SpawnPromise<SpawnResult> = spawn(command, args, {
    env,
    stdio: 'pipe',
  });
  const timeout = setTimeout(() => {
    spawnPromise.child.kill('SIGKILL');
  }, PREWARM_TIMEOUT_MS);
  timeout.unref();

  try {
    return await spawnPromise;
  } finally {
    clearTimeout(timeout);
  }
}
