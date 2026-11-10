import SimulatorAvailability from '../../commands/simulator/availability';
import SimulatorControl from '../../commands/simulator/control';
import SimulatorEgress from '../../commands/simulator/egress';
import SimulatorEvents from '../../commands/simulator/events';
import SimulatorExec from '../../commands/simulator/exec';
import SimulatorGet from '../../commands/simulator/get';
import Simulator from '../../commands/simulator/index';
import SimulatorList from '../../commands/simulator/list';
import SimulatorLogs from '../../commands/simulator/logs';
import SimulatorStop from '../../commands/simulator/stop';
import { isSimulatorCommandId } from '../commandAliases';

describe('simulator command aliases', () => {
  it.each([
    ['availability', SimulatorAvailability],
    ['control', SimulatorControl],
    ['egress', SimulatorEgress],
    ['events', SimulatorEvents],
    ['exec', SimulatorExec],
    ['get', SimulatorGet],
    ['list', SimulatorList],
    ['logs', SimulatorLogs],
    ['stop', SimulatorStop],
  ])('runs simulator:%s from every simulator topic alias', (name, command) => {
    expect(command.aliases).toEqual([`sim:${name}`]);
    expect(command.hiddenAliases).toEqual([
      `simulators:${name}`,
      `emulator:${name}`,
      `emulators:${name}`,
    ]);
  });

  it('runs simulator:start from the bare topic aliases', () => {
    expect(Simulator.aliases).toEqual(['simulator:start', 'sim:start']);
    expect(Simulator.hiddenAliases).toEqual([
      'sim',
      'simulators',
      'emulator',
      'emulators',
      'simulators:start',
      'emulator:start',
      'emulators:start',
    ]);
  });

  it.each(['simulator:control', 'sim:control', 'simulators:control', 'emulators:control'])(
    'matches %s as simulator:control',
    id => {
      expect(isSimulatorCommandId(id, 'control')).toBe(true);
    }
  );

  it.each([undefined, 'simulator:list', 'control', 'device:control'])(
    'does not match %s as simulator:control',
    id => {
      expect(isSimulatorCommandId(id, 'control')).toBe(false);
    }
  );
});
