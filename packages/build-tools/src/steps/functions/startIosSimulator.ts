import {
  BuildFunction,
  BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { minBy } from 'lodash';

import {
  IosSimulatorName,
  IosSimulatorUtils,
  IosSimulatorUuid,
} from '../../utils/IosSimulatorUtils';

export function createStartIosSimulatorBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_ios_simulator',
    name: 'Start iOS Simulator',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'device_identifier',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'count',
        required: false,
        defaultValue: 1,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
    ],
    fn: async ({ logger }, { inputs, env }) => {
      try {
        const availableDevices = await IosSimulatorUtils.getAvailableDevicesAsync({
          env,
          filter: 'available',
        });
        logger.info(
          `Available Simulator devices:\n- ${availableDevices
            .map((device) => device.displayName)
            .join(`\n- `)}`
        );
      } catch (error) {
        logger.info('Failed to list available Simulator devices.', error);
      } finally {
        logger.info('');
      }

      const deviceIdentifierInput = inputs.device_identifier.value?.toString() as
        | IosSimulatorUuid
        | IosSimulatorName
        | undefined;
      const originalDeviceIdentifier =
        deviceIdentifierInput ?? (await findMostGenericIphoneUuidAsync({ env }));

      if (!originalDeviceIdentifier) {
        throw new Error('Could not find an iPhone among available simulator devices.');
      }

      const { udid } = await IosSimulatorUtils.startAsync({
        deviceIdentifier: originalDeviceIdentifier,
        env,
      });

      await IosSimulatorUtils.waitForReadyAsync({ udid, env });

      logger.info('');

      const device = await IosSimulatorUtils.getDeviceAsync({ udid, env });
      const formattedDevice = device?.displayName ?? originalDeviceIdentifier;
      logger.info(`${formattedDevice} is ready.`);

      const count = Number(inputs.count.value ?? 1);
      if (count > 1) {
        logger.info(`Requested ${count} Simulators, shutting down ${formattedDevice} for cloning.`);
        await spawn('xcrun', ['simctl', 'shutdown', originalDeviceIdentifier], {
          logger,
          env,
        });

        for (let i = 0; i < count; i++) {
          const cloneDeviceName = `eas-simulator-${i + 1}` as IosSimulatorName;
          logger.info(`Cloning ${formattedDevice} to ${cloneDeviceName}...`);

          await IosSimulatorUtils.cloneAsync({
            sourceDeviceIdentifier: originalDeviceIdentifier,
            destinationDeviceName: cloneDeviceName,
            env,
          });

          const { udid: cloneUdid } = await IosSimulatorUtils.startAsync({
            deviceIdentifier: cloneDeviceName,
            env,
          });

          await IosSimulatorUtils.waitForReadyAsync({
            udid: cloneUdid,
            env,
          });

          logger.info(`${cloneDeviceName} is ready.`);
          logger.info('');
        }
      }
    },
  });
}

async function findMostGenericIphoneUuidAsync({
  env,
}: {
  env: BuildStepEnv;
}): Promise<IosSimulatorUuid | null> {
  const availableSimulatorDevices = await IosSimulatorUtils.getAvailableDevicesAsync({
    env,
    filter: 'available',
  });
  const availableIphones = availableSimulatorDevices.filter((device) =>
    device.name.startsWith('iPhone')
  );
  // It's funny, but it works.
  const iphoneWithShortestName = minBy(availableIphones, (device) => device.name.length);
  return iphoneWithShortestName?.udid ?? null;
}
