import * as PackageManager from '@expo/package-manager';
import fs from 'fs/promises';
import yaml from 'js-yaml';
import * as path from 'path';
import semver from 'semver';

import Log from '../log';

export async function installNodeDependenciesAsync(
  projectRoot: string,
  packageManager: 'yarn' | 'npm'
): Promise<void> {
  const options = { cwd: projectRoot };
  if (packageManager === 'yarn') {
    const yarn = new PackageManager.YarnPackageManager(options);
    const version = await yarn.versionAsync();
    const nodeLinker = await yarn.getConfigAsync('nodeLinker');
    if (semver.satisfies(version, '>=2.0.0-rc.24') && nodeLinker !== 'node-modules') {
      const yarnRc = path.join(projectRoot, '.yarnrc.yml');
      let yamlString = '';
      try {
        yamlString = await fs.readFile(yarnRc, 'utf8');
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
      const config: any = yamlString ? yaml.safeLoad(yamlString) : {};
      config.nodeLinker = 'node-modules';

      Log.warn(
        `Yarn v${version} detected, enabling experimental Yarn v2 support using the node-modules plugin.`
      );
      Log.log(`Writing ${yarnRc}...`);
      await fs.writeFile(yarnRc, yaml.safeDump(config));
    }
    await yarn.installAsync();
  } else {
    await new PackageManager.NpmPackageManager(options).installAsync();
  }
}
