import plist from '@expo/plist';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import fs from 'fs-extra';
import path from 'node:path';
import StreamZip from 'node-stream-zip';
import { z } from 'zod';

export type IpaInfo = {
  bundleIdentifier: string;
  bundleShortVersion: string;
  bundleVersion: string;
};

const INFO_PLIST_PATH_REGEXP = /^Payload\/[^/]+\.app\/Info\.plist$/;

export function createReadIpaInfoBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'read_ipa_info',
    name: 'Read IPA Info',
    __metricsId: 'eas/read_ipa_info',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'ipa_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'bundle_identifier',
        required: true,
      }),
      BuildStepOutput.createProvider({
        id: 'bundle_short_version',
        required: true,
      }),
      BuildStepOutput.createProvider({
        id: 'bundle_version',
        required: true,
      }),
    ],
    fn: async (stepCtx, { inputs, outputs }) => {
      const ipaPathInput = z.string().parse(inputs.ipa_path.value);
      const ipaPath = path.resolve(stepCtx.workingDirectory, ipaPathInput);
      if (!(await fs.pathExists(ipaPath))) {
        throw new Error(`IPA file not found: ${ipaPath}`);
      }

      const ipaInfo = await readIpaInfoAsync(ipaPath);
      outputs.bundle_identifier.set(ipaInfo.bundleIdentifier);
      outputs.bundle_short_version.set(ipaInfo.bundleShortVersion);
      outputs.bundle_version.set(ipaInfo.bundleVersion);
    },
  });
}

export async function readIpaInfoAsync(ipaPath: string): Promise<IpaInfo> {
  const zip = new StreamZip.async({ file: ipaPath });
  try {
    const entries = Object.values(await zip.entries());
    const infoPlistEntry = entries.find(entry => INFO_PLIST_PATH_REGEXP.test(entry.name));
    if (!infoPlistEntry) {
      throw new Error(`Could not find Info.plist in ${ipaPath}`);
    }

    const infoPlistBuffer = await zip.entryData(infoPlistEntry.name);
    const infoPlist = plist.parse(infoPlistBuffer.toString('utf8')) as Record<string, unknown>;
    return {
      bundleIdentifier: getRequiredStringValue(infoPlist, 'CFBundleIdentifier'),
      bundleShortVersion: getRequiredStringValue(infoPlist, 'CFBundleShortVersionString'),
      bundleVersion: getRequiredStringValue(infoPlist, 'CFBundleVersion'),
    };
  } catch (error) {
    throw new Error(`Failed to read IPA info: ${(error as Error).message}`);
  } finally {
    await zip.close();
  }
}

function getRequiredStringValue(plistData: Record<string, unknown>, key: string): string {
  const value = plistData[key];
  if (typeof value !== 'string') {
    throw new Error(`Missing or invalid ${key} in Info.plist`);
  }
  return value;
}
