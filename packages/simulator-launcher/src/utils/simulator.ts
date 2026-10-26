import { z } from 'zod';

import { commands } from './processes';
import { type SimulatorDevice, SimulatorDeviceSchema } from './state';

const AvailableSimulatorsSchema = z.object({
  devices: z.record(
    z.string(),
    z.array(SimulatorDeviceSchema.extend({ isAvailable: z.boolean().optional() }))
  ),
});
const SimulatorStatesSchema = z.object({
  devices: z.record(z.string(), z.array(z.object({ udid: z.string(), state: z.string() }))),
});

export async function listAvailableSimulatorsAsync(
  signal: AbortSignal
): Promise<SimulatorDevice[]> {
  const { devices } = AvailableSimulatorsSchema.parse(
    JSON.parse(
      await commands.runAsync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], signal)
    )
  );
  return Object.values(devices)
    .flat()
    .filter(device => device.isAvailable !== false);
}

/** Devices matching an exact name or UDID, or else the available iPhone with the shortest name. */
export function selectSimulators(devices: SimulatorDevice[], selector?: string): SimulatorDevice[] {
  return selector
    ? devices.filter(
        device => device.name === selector || device.udid.toLowerCase() === selector.toLowerCase()
      )
    : devices
        .filter(device => device.name.startsWith('iPhone'))
        .sort((a, b) => a.name.length - b.name.length)
        .slice(0, 1);
}

/** Resolve every configured warm device before native work; the first is the claim default. */
export function selectWarmupSimulators(
  devices: SimulatorDevice[],
  selectors?: string
): SimulatorDevice[] {
  const entries =
    selectors === undefined ? [undefined] : selectors.split(',').map(value => value.trim());
  const selected = new Set<string>();
  return entries.map(selector => {
    if (selector === '') {
      throw new Error('EXPO_SIMULATOR_DEVICE must contain nonempty device names or UDIDs.');
    }
    const matches = selectSimulators(devices, selector);
    if (matches.length !== 1) {
      throw new Error(
        `Expected one available Simulator for ${selector ?? 'the default iPhone'}, found ${matches.length}. Use an exact device name or UDID.`
      );
    }
    const device = matches[0];
    const udid = device.udid.toLowerCase();
    if (selected.has(udid)) {
      throw new Error(
        `Simulator ${device.name} (${device.udid}) appears more than once in EXPO_SIMULATOR_DEVICE.`
      );
    }
    selected.add(udid);
    return device;
  });
}

export async function bootSimulatorAsync(udid: string, signal: AbortSignal): Promise<void> {
  await commands.runAsync('xcrun', ['simctl', 'bootstatus', udid, '-b'], signal).catch(async () => {
    signal.throwIfAborted();
    await commands.runAsync('xcrun', ['simctl', 'bootstatus', udid], signal);
  });
}

/** `simctl shutdown` fails for a device that is already shut down; that device is done. */
export async function shutdownSimulatorAsync(udid: string): Promise<void> {
  try {
    await commands.runAsync('xcrun', ['simctl', 'shutdown', udid]);
  } catch (error) {
    const { devices } = SimulatorStatesSchema.parse(
      JSON.parse(await commands.runAsync('xcrun', ['simctl', 'list', 'devices', '--json']))
    );
    if (
      Object.values(devices)
        .flat()
        .find(device => device.udid === udid)?.state !== 'Shutdown'
    ) {
      throw error;
    }
  }
}

/** Push notifications are not used in warm sessions, and apsd's work competes with app installs. */
export async function disableApsdAsync(udid: string, signal: AbortSignal): Promise<void> {
  const launchctl = (...args: string[]): Promise<string> =>
    commands.runAsync('xcrun', ['simctl', 'spawn', udid, 'launchctl', ...args], signal);
  let lastError: unknown;
  for (const domain of ['user/foreground', 'system']) {
    const service = `${domain}/com.apple.apsd`;
    try {
      await launchctl('disable', service);
      // bootout fails when apsd is already gone; the list check below decides.
      await launchctl('bootout', service).catch(error => {
        lastError = error;
      });
      // launchctl list exits 113 for a service that is not loaded.
      const loaded = await launchctl('list', 'com.apple.apsd').then(
        () => true,
        error => (error.code === 113 ? false : Promise.reject(error))
      );
      if (!loaded) {
        return;
      }
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
    }
  }
  throw lastError ?? new Error('apsd is still loaded in the Simulator.');
}
