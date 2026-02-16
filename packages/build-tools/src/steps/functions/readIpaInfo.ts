import { UserFacingError } from '@expo/eas-build-job/dist/errors';
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
import bplistParser from 'bplist-parser';
import plist from 'plist';

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
    const infoPlist = parseInfoPlistBuffer(infoPlistBuffer);
    return {
      bundleIdentifier: getRequiredStringValue(infoPlist, 'CFBundleIdentifier'),
      bundleShortVersion: getRequiredStringValue(infoPlist, 'CFBundleShortVersionString'),
      bundleVersion: getRequiredStringValue(infoPlist, 'CFBundleVersion'),
    };
  } catch (error) {
    throw new UserFacingError(
      'EAS_READ_IPA_INFO_FAILED',
      `Failed to read IPA info: ${(error as Error).message}`
    );
  } finally {
    await zip.close();
  }
}

function parseInfoPlistBuffer(data: Buffer): Record<string, unknown> {
  if (isBinaryPlist(data)) {
    const parsedBinaryPlists = bplistParser.parseBuffer(data);
    const parsedBinaryPlist = parsedBinaryPlists[0];
    if (!parsedBinaryPlist || typeof parsedBinaryPlist !== 'object') {
      throw new UserFacingError(
        'EAS_READ_IPA_INFO_INVALID_BINARY_PLIST',
        'Invalid binary plist in IPA'
      );
    }
    return parsedBinaryPlist as Record<string, unknown>;
  }

  return plist.parse(data.toString('utf8')) as Record<string, unknown>;
}

function isBinaryPlist(data: Buffer): boolean {
  return data.subarray(0, 8).toString('ascii') === 'bplist00';
}

function getRequiredStringValue(plistData: Record<string, unknown>, key: string): string {
  const value = plistData[key];
  if (typeof value !== 'string') {
    throw new Error(`Missing or invalid ${key} in Info.plist`);
  }
  return value;
}
