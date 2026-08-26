import fs from 'fs-extra';
import path from 'path';

/**
 * React Native's generated autolinking state contains absolute paths. A user cache created on a
 * different operating system can therefore link Gradle projects to directories that do not exist
 * on the worker. Always regenerate this small cache after restoring user-controlled build output.
 */
export async function clearReactNativeAutolinkingCacheAsync(
  projectDirectory: string
): Promise<void> {
  await fs.remove(path.join(projectDirectory, 'android/build/generated/autolinking'));
}
