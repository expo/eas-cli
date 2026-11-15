import { selectWarmupSimulators } from '../utils/simulator';

const devices = [
  { udid: 'DUO', name: 'iPhone Duo' },
  { udid: 'PHONE18', name: 'iPhone 18' },
  { udid: 'PRO18', name: 'iPhone 18 Pro' },
];

test('keeps the shortest available iPhone as the default when unset', () => {
  expect(selectWarmupSimulators(devices)).toEqual([devices[1]]);
});
test('splits and trims a list, preserving its default and accepting case-insensitive UDIDs', () => {
  expect(selectWarmupSimulators(devices, ' iPhone 18 , duo ')).toEqual([devices[1], devices[0]]);
});
test.each(['iPhone Duo,', ',iPhone 18', 'iPhone Duo, ,iPhone 18'])(
  'rejects an empty entry in %j',
  selectors => {
    expect(() => selectWarmupSimulators(devices, selectors)).toThrow('nonempty');
  }
);
test('rejects a missing or ambiguous device instead of choosing arbitrarily', () => {
  expect(() => selectWarmupSimulators(devices, 'missing')).toThrow('found 0');
  expect(() =>
    selectWarmupSimulators([...devices, { udid: 'OTHER', name: 'iPhone Duo' }], 'iPhone Duo')
  ).toThrow('found 2');
});
test('rejects two selectors for the same device', () => {
  expect(() => selectWarmupSimulators(devices, 'iPhone Duo,duo')).toThrow('more than once');
});
test.each(['', '  ', '\n'])('keeps the default iPhone for blank configuration %j', selectors => {
  expect(selectWarmupSimulators(devices, selectors)).toEqual([devices[1]]);
});

test('observes an orphan-owned boot without requesting a new boot', async () => {
  const { commands } = await import('../utils/processes');
  const { waitForSimulatorBootAsync } = await import('../utils/simulator');
  const run = jest
    .spyOn(commands, 'runAsync')
    .mockImplementation(async (_file, args) =>
      args.includes('devices')
        ? JSON.stringify({ devices: { ios: [{ udid: 'DUO', state: 'Booted' }] } })
        : ''
    );
  try {
    await waitForSimulatorBootAsync('DUO', new AbortController().signal);
    expect(run).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'bootstatus', 'DUO'],
      expect.any(AbortSignal)
    );
    expect(run.mock.calls.some(([, args]) => args.includes('-b') || args.includes('boot'))).toBe(
      false
    );
  } finally {
    run.mockRestore();
  }
});

test('a claim can cancel boot observation without issuing a native command', async () => {
  const { commands } = await import('../utils/processes');
  const { waitForSimulatorBootAsync } = await import('../utils/simulator');
  const run = jest
    .spyOn(commands, 'runAsync')
    .mockRejectedValue(new Error('unexpected native command'));
  const cancel = new AbortController();
  cancel.abort(new Error('claimed'));
  try {
    await expect(waitForSimulatorBootAsync('DUO', cancel.signal)).rejects.toThrow('claimed');
    expect(run).not.toHaveBeenCalled();
  } finally {
    run.mockRestore();
  }
});
