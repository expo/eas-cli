import fs from 'fs-extra';
import path from 'path';

import { clearReactNativeAutolinkingCacheAsync } from '../autolinking';

describe(clearReactNativeAutolinkingCacheAsync, () => {
  it('removes the generated autolinking cache without removing other Android build output', async () => {
    const projectDirectory = '/workingdir/build';
    const autolinkingDirectory = path.join(projectDirectory, 'android/build/generated/autolinking');
    const unrelatedBuildOutput = path.join(projectDirectory, 'android/build/outputs/keep.txt');

    await fs.outputJson(path.join(autolinkingDirectory, 'autolinking.json'), {
      dependencies: {
        'react-native-screens': {
          platforms: {
            android: {
              sourceDir: 'C:\\Users\\expo\\app\\node_modules\\react-native-screens\\android',
            },
          },
        },
      },
    });
    await fs.outputFile(unrelatedBuildOutput, 'keep');

    await clearReactNativeAutolinkingCacheAsync(projectDirectory);

    await expect(fs.pathExists(autolinkingDirectory)).resolves.toBe(false);
    await expect(fs.readFile(unrelatedBuildOutput, 'utf8')).resolves.toBe('keep');
  });
});
