import { bunyan } from '@expo/logger';
import { BuildFunction, spawnAsync } from '@expo/steps';
import fs from 'fs';
import path from 'path';

import { PODS_CACHE_DIR } from './restoreXcodeCache';

const PATCH_RUBY_SCRIPT = `
require 'xcodeproj'

project = Xcodeproj::Project.open('ios/Pods/Pods.xcodeproj')

umbrella_targets = project.native_targets.select { |t| t.name.start_with?('Pods-') }
abort "ERROR: No Pods-* umbrella targets found!" if umbrella_targets.empty?

umbrella_names = umbrella_targets.map(&:name)
puts "Keeping umbrella targets: #{umbrella_names.join(', ')}"

pod_targets = project.native_targets.reject { |t| t.name.start_with?('Pods-') }
puts "Found #{pod_targets.size} pod targets to remove"

umbrella_targets.each do |umbrella|
  deps = umbrella.dependencies.to_a
  deps.each { |dep| dep.remove_from_project }
  puts "Cleared #{deps.size} dependencies from #{umbrella.name}"
end

pod_targets.each do |target|
  target.remove_from_project
end

project.save
puts "Saved — #{project.native_targets.size} target(s) remaining"
`;

export function createPatchPodsXcodeprojFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'patch_pods_xcodeproj',
    name: 'Patch Pods Xcodeproj',
    __metricsId: 'eas/patch_pods_xcodeproj',
    fn: async (stepCtx, { env }) => {
      const { logger } = stepCtx;

      await patchPodsXcodeprojAsync({
        logger,
        workingDirectory: stepCtx.workingDirectory,
        env,
        cacheHit: false,
      });
    },
  });
}

export async function patchPodsXcodeprojAsync({
  logger,
  workingDirectory,
  env,
  cacheHit,
}: {
  logger: bunyan;
  workingDirectory: string;
  env: Record<string, string | undefined>;
  cacheHit: boolean;
}): Promise<void> {
  logger.info(`[patchPodsXcodeprojAsync] entered, XCODE_CACHE=${env.XCODE_CACHE ?? 'unset'}, cacheHit=${cacheHit}`);

  if (env.XCODE_CACHE !== '1' || !cacheHit) {
    logger.info('[patchPodsXcodeprojAsync] skipping (cache not enabled or no cache hit)');
    return;
  }

  logger.info('Patching Pods.xcodeproj to remove pod targets...');

  await spawnAsync('ruby', ['-e', PATCH_RUBY_SCRIPT], {
    cwd: workingDirectory,
    logger,
    env,
    stdio: 'pipe',
  });

  logger.info('Pods.xcodeproj patched successfully');

  // Point PODS_CONFIGURATION_BUILD_DIR to the stable cache directory
  // so Xcode finds pre-built products there instead of in DerivedData
  // (xcodebuild archive wipes ArchiveIntermediates on each run).
  await patchPodXcconfigAsync(workingDirectory, logger);

  logger.info('Pods xcconfig patched successfully');
}

/**
 * Patch all pod xcconfig files to override PODS_CONFIGURATION_BUILD_DIR
 * to point to the stable cache directory.
 */
async function patchPodXcconfigAsync(workingDirectory: string, logger: bunyan): Promise<void> {
  const targetSupportDir = path.join(workingDirectory, 'ios', 'Pods', 'Target Support Files');

  let patchCount = 0;
  const entries = await fs.promises.readdir(targetSupportDir);
  for (const entry of entries) {
    // Only patch Pods-* umbrella xcconfigs
    if (!entry.startsWith('Pods-')) {
      continue;
    }
    const dir = path.join(targetSupportDir, entry);
    const stat = await fs.promises.stat(dir);
    if (!stat.isDirectory()) {
      continue;
    }
    const files = await fs.promises.readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.xcconfig')) {
        continue;
      }
      const filePath = path.join(dir, file);
      let content = await fs.promises.readFile(filePath, 'utf-8');
      if (content.includes('PODS_CONFIGURATION_BUILD_DIR')) {
        content = content.replace(
          /PODS_CONFIGURATION_BUILD_DIR\s*=\s*.*/g,
          `PODS_CONFIGURATION_BUILD_DIR = ${PODS_CACHE_DIR}`
        );
        await fs.promises.writeFile(filePath, content);
        patchCount++;
        logger.info(`Patched ${filePath}`);
      }
    }
  }
  logger.info(`Patched ${patchCount} xcconfig files`);
}
