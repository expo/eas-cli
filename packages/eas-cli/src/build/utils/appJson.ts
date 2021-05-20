import * as ExpoConfig from '@expo/config';
import assert from 'assert';
import fs from 'fs-extra';

export async function updateAppJsonConfigAsync(
  {
    projectDir,
    exp,
  }: {
    projectDir: string;
    exp: ExpoConfig.ExpoConfig;
  },
  modifyConfig: (config: any) => void
): Promise<void> {
  const paths = ExpoConfig.getConfigFilePaths(projectDir);
  assert(paths.staticConfigPath, "can't update dynamic config");

  const rawStaticConfig = await fs.readJSON(paths.staticConfigPath);
  rawStaticConfig.expo = rawStaticConfig.expo ?? {};
  modifyConfig(rawStaticConfig.expo);
  await fs.writeJson(paths.staticConfigPath, rawStaticConfig, { spaces: 2 });

  modifyConfig(exp);
}
