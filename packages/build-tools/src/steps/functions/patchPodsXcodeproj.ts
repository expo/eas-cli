import { bunyan } from '@expo/logger';
import { BuildFunction, spawnAsync } from '@expo/steps';
import fs from 'fs';

import { XCODE_CACHE_HIT_FLAG } from './restoreXcodeCache';

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
      });
    },
  });
}

export async function patchPodsXcodeprojAsync({
  logger,
  workingDirectory,
  env,
}: {
  logger: bunyan;
  workingDirectory: string;
  env: Record<string, string | undefined>;
}): Promise<void> {
  logger.info(`[patchPodsXcodeprojAsync] entered, XCODE_CACHE=${env.XCODE_CACHE ?? 'unset'}`);

  if (env.XCODE_CACHE !== '1') {
    logger.info('[patchPodsXcodeprojAsync] XCODE_CACHE not set to 1, skipping');
    return;
  }

  // Only patch if cache was restored
  try {
    const flag = await fs.promises.readFile(XCODE_CACHE_HIT_FLAG, 'utf-8');
    if (flag.trim() !== '1') {
      logger.info('No Xcode cache hit — skipping Pods.xcodeproj patch');
      return;
    }
  } catch {
    logger.info('No Xcode cache hit — skipping Pods.xcodeproj patch');
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
}
