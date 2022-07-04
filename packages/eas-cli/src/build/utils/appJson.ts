import * as ExpoConfig from '@expo/config';
import JsonFileModule from '@expo/json-file';
import assert from 'assert';

const JsonFile = JsonFileModule.default;

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

  const rawStaticConfig = readAppJson(paths.staticConfigPath);
  rawStaticConfig.expo = rawStaticConfig.expo ?? {};
  modifyConfig(rawStaticConfig.expo);
  await JsonFile.writeAsync(paths.staticConfigPath, rawStaticConfig, { json5: false });

  modifyConfig(exp);
}

// TODO: remove this once @expo/config exports getStaticConfig
export function readAppJson(appJsonPath: string): any {
  const config = JsonFile.read(appJsonPath, { json5: true });
  if (config) {
    return config as any;
  }
  throw new Error(`Failed to read app.json`);
}
