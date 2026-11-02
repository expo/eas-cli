import { z } from 'zod';

export const AndroidEmulatorLogSourcesSchema = z.array(
  z.enum(['emulator-output', 'device-logcat'])
);
export type AndroidEmulatorLogSource = z.infer<typeof AndroidEmulatorLogSourcesSchema>[number];

// Existing build workflows capture both sources. Device sessions pass their selection explicitly.
export const LEGACY_ANDROID_EMULATOR_LOG_SOURCES: readonly AndroidEmulatorLogSource[] = [
  'emulator-output',
  'device-logcat',
];
