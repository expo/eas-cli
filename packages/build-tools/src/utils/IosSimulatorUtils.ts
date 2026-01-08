import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { setTimeout } from 'node:timers/promises';

import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import { z } from 'zod';

import { retryAsync } from './retry';

export type IosSimulatorUuid = string & z.BRAND<'IosSimulatorUuid'>;
export type IosSimulatorName = string & z.BRAND<'IosSimulatorName'>;

export namespace IosSimulatorUtils {
  type XcrunSimctlDevice = {
    availabilityError?: string;
    /** e.g. /Users/sjchmiela/Library/Developer/CoreSimulator/Devices/8272DEB1-42B5-4F78-AB2D-0BC5F320B822/data */
    dataPath: string;
    /** e.g. 18341888 */
    dataPathSize: number;
    /** e.g. /Users/sjchmiela/Library/Logs/CoreSimulator/8272DEB1-42B5-4F78-AB2D-0BC5F320B822 */
    logPath: string;
    /** e.g. 8272DEB1-42B5-4F78-AB2D-0BC5F320B822 */
    udid: IosSimulatorUuid;
    isAvailable: boolean;
    /** e.g. com.apple.CoreSimulator.SimDeviceType.iPhone-13-mini */
    deviceTypeIdentifier: string;
    state: 'Shutdown' | 'Booted';
    /** e.g. iPhone 15 */
    name: IosSimulatorName;
    /** e.g. 2024-01-22T19:28:56Z */
    lastBootedAt?: string;
  };

  type SimulatorDevice = XcrunSimctlDevice & { runtime: string; displayName: string };

  type XcrunSimctlListDevicesJsonOutput = {
    devices: {
      [runtime: string]: XcrunSimctlDevice[];
    };
  };

  export async function getAvailableDevicesAsync({
    env,
    filter,
  }: {
    env: NodeJS.ProcessEnv;
    filter: 'available' | 'booted';
  }): Promise<SimulatorDevice[]> {
    const result = await spawn(
      'xcrun',
      ['simctl', 'list', 'devices', '--json', '--no-escape-slashes', filter],
      { env }
    );
    const xcrunData = JSON.parse(result.stdout) as XcrunSimctlListDevicesJsonOutput;

    const allAvailableDevices: SimulatorDevice[] = [];
    for (const [runtime, devices] of Object.entries(xcrunData.devices)) {
      allAvailableDevices.push(
        ...devices.map((device) => ({
          ...device,
          runtime,
          displayName: `${device.name} (${device.udid}) on ${runtime}`,
        }))
      );
    }

    return allAvailableDevices;
  }

  export async function getDeviceAsync({
    udid,
    env,
  }: {
    env: NodeJS.ProcessEnv;
    udid: IosSimulatorUuid;
  }): Promise<SimulatorDevice | null> {
    const devices = await getAvailableDevicesAsync({ env, filter: 'available' });
    return devices.find((device) => device.udid === udid) ?? null;
  }

  export async function cloneAsync({
    sourceDeviceIdentifier,
    destinationDeviceName,
    env,
  }: {
    sourceDeviceIdentifier: IosSimulatorName | IosSimulatorUuid;
    destinationDeviceName: IosSimulatorName;
    env: NodeJS.ProcessEnv;
  }): Promise<void> {
    await spawn('xcrun', ['simctl', 'clone', sourceDeviceIdentifier, destinationDeviceName], {
      env,
    });
  }

  export async function startAsync({
    deviceIdentifier,
    env,
  }: {
    deviceIdentifier: IosSimulatorUuid | IosSimulatorName;
    env: NodeJS.ProcessEnv;
  }): Promise<{ udid: IosSimulatorUuid }> {
    const bootstatusResult = await spawn(
      'xcrun',
      ['simctl', 'bootstatus', deviceIdentifier, '-b'],
      {
        env,
      }
    );

    const udid = parseUdidFromBootstatusStdout(bootstatusResult.stdout);
    if (!udid) {
      throw new Error('Failed to parse UDID from bootstatus result.');
    }

    return { udid };
  }

  export async function waitForReadyAsync({
    udid,
    env,
  }: {
    udid: IosSimulatorUuid;
    env: NodeJS.ProcessEnv;
  }): Promise<void> {
    await retryAsync(
      async () => {
        await spawn('xcrun', ['simctl', 'io', udid, 'screenshot', '/dev/null'], {
          env,
        });
      },
      {
        retryOptions: {
          // There's 30 * 60 seconds in 30 minutes, which is the timeout.
          retries: 30 * 60,
          retryIntervalMs: 1_000,
        },
      }
    );

    // Wait for data migration to complete before declaring the simulator ready
    // Based on WebKit's approach: https://trac.webkit.org/changeset/231452/webkit
    await retryAsync(
      async () => {
        const isDataMigrating = await isDataMigratorProcessRunning({ env });
        if (isDataMigrating) {
          throw new Error('com.apple.datamigrator still running');
        }
      },
      {
        retryOptions: {
          retries: 30 * 60,
          retryIntervalMs: 1_000,
        },
      }
    );
  }

  export async function collectLogsAsync({
    deviceIdentifier,
    env,
  }: {
    deviceIdentifier: IosSimulatorName | IosSimulatorUuid;
    env: NodeJS.ProcessEnv;
  }): Promise<{ outputPath: string }> {
    const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ios-simulator-logs-'));
    const outputPath = path.join(outputDir, `${deviceIdentifier}.logarchive`);

    await spawn(
      'xcrun',
      ['simctl', 'spawn', deviceIdentifier, 'log', 'collect', '--output', outputPath],
      {
        env,
      }
    );

    return { outputPath };
  }

  export async function deleteAsync({
    deviceIdentifier,
    env,
  }: {
    deviceIdentifier: IosSimulatorName | IosSimulatorUuid;
    env: NodeJS.ProcessEnv;
  }): Promise<void> {
    await spawn('xcrun', ['simctl', 'shutdown', deviceIdentifier], { env });
    await spawn('xcrun', ['simctl', 'delete', deviceIdentifier], { env });
  }

  export async function startScreenRecordingAsync({
    deviceIdentifier,
    env,
  }: {
    deviceIdentifier: IosSimulatorUuid | IosSimulatorName;
    env: NodeJS.ProcessEnv;
  }): Promise<{
    recordingSpawn: SpawnPromise<SpawnResult>;
    outputPath: string;
  }> {
    const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ios-screen-recording-'));
    const outputPath = path.join(outputDir, `${deviceIdentifier}.mov`);
    const recordingSpawn = spawn(
      'xcrun',
      ['simctl', 'io', deviceIdentifier, 'recordVideo', '-f', outputPath],
      {
        env,
      }
    );

    const stdout = recordingSpawn.child.stdout;
    const stderr = recordingSpawn.child.stderr;
    if (!stdout || !stderr) {
      // No stdout/stderr means the process failed to start, so awaiting it will throw an error.
      await recordingSpawn;
      throw new Error('Recording process failed to start.');
    }

    let outputAggregated = '';

    // Listen to both stdout and stderr since "Recording started" might come from either
    stdout.on('data', (data) => {
      const output = data.toString();
      outputAggregated += output;
    });

    stderr.on('data', (data) => {
      const output = data.toString();
      outputAggregated += output;
    });

    let isRecordingStarted = false;
    for (let i = 0; i < 20; i++) {
      // Check if recording started message appears in either stdout or stderr
      if (outputAggregated.includes('Recording started')) {
        isRecordingStarted = true;
        break;
      }
      await setTimeout(1000);
    }

    if (!isRecordingStarted) {
      throw new Error('Recording not started in time.');
    }

    return { recordingSpawn, outputPath };
  }

  export async function stopScreenRecordingAsync({
    recordingSpawn,
  }: {
    recordingSpawn: SpawnPromise<SpawnResult>;
  }): Promise<void> {
    recordingSpawn.child.kill(2);
    await recordingSpawn;
  }

  /**
   * Check if any com.apple.datamigrator processes are running.
   * The existence of these processes indicates that simulators are still booting/migrating data.
   * Based on WebKit's approach: https://trac.webkit.org/changeset/231452/webkit
   */
  export async function isDataMigratorProcessRunning({
    env,
  }: {
    env: NodeJS.ProcessEnv;
  }): Promise<boolean> {
    try {
      const result = await spawn('ps', ['-eo', 'pid,comm'], { env });

      return result.stdout.includes('com.apple.datamigrator');
    } catch {
      // If ps command fails, assume no data migration processes are running
      return false;
    }
  }
}

function parseUdidFromBootstatusStdout(stdout: string): IosSimulatorUuid | null {
  const matches = stdout.match(/^Monitoring boot status for .+ \((.+)\)\.$/m);
  if (!matches) {
    return null;
  }
  return matches[1] as IosSimulatorUuid;
}
