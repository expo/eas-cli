import { selectSimulators } from '../utils/simulator';

const devices = [
  { udid: 'DUO', name: 'iPhone Duo' },
  { udid: 'PHONE18', name: 'iPhone 18' },
  { udid: 'PRO18', name: 'iPhone 18 Pro' },
];

test('keeps the shortest available iPhone as the default', () => {
  expect(selectSimulators(devices)).toEqual([devices[1]]);
});
test('matches exact names and case-insensitive UDIDs', () => {
  expect(selectSimulators(devices, 'iPhone Duo')).toEqual([devices[0]]);
  expect(selectSimulators(devices, 'phone18')).toEqual([devices[1]]);
  expect(selectSimulators(devices, 'iPhone')).toEqual([]);
});
test('returns every exact name match so callers can reject ambiguous devices', () => {
  const duplicate = { udid: 'OTHER', name: 'iPhone Duo' };
  expect(selectSimulators([...devices, duplicate], 'iPhone Duo')).toEqual([devices[0], duplicate]);
});
