import { parseGuestProcesses } from '../guestMetricsRecorder';

describe(parseGuestProcesses, () => {
  it('parses cumulative CPU, parentage, start identity and paths containing spaces', () => {
    expect(
      parseGuestProcesses(
        ' 12 1 Thu Oct  1 14:51:02 2026 2-03:04:05.50 200 /Applications/My App.app/App'
      )[0]
    ).toEqual({
      pid: 12,
      ppid: 1,
      started: 'Thu Oct  1 14:51:02 2026',
      cpuSeconds: 183845.5,
      rssBytes: 204800,
      executable: '/Applications/My App.app/App',
    });
    expect(
      parseGuestProcesses('12 1 Thu Oct  1 14:51:02 2026 3:05.25 200 /bin/app')[0].cpuSeconds
    ).toBe(185.25);
  });

  it('rejects an unrecognized row rather than silently undercounting', () => {
    expect(() => parseGuestProcesses('12 broken')).toThrow('Unrecognized ps row');
  });
});
