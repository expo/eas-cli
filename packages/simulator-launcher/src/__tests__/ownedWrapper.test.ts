import { startOwnedWrapperAsync } from './fixtures/ownedWrapper';

it('confirms cleanup when a real owned wrapper propagates intentionally stopped children as exit 23', async () => {
  const fixture = await startOwnedWrapperAsync();
  const { job, leaves, realKill } = fixture;
  try {
    const kill = jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === job.child.pid && (job.child.exitCode !== null || job.child.signalCode !== null)) {
        throw new Error('An exited wrapper PID must never be probed or signalled.');
      }
      return realKill(pid, signal);
    });
    await expect(fixture.stopAsync()).resolves.toBeUndefined();
    expect(job.child.exitCode).toBe(23);
    await expect(job.resultPromise).rejects.toMatchObject({ code: 23 });
    expect(
      kill.mock.calls.filter(([, signal]) => signal === 'SIGTERM').map(([pid]) => pid)
    ).toEqual(expect.arrayContaining(leaves));
    for (const pid of leaves) {
      expect(() => realKill(pid, 0)).toThrow();
    }
  } finally {
    jest.restoreAllMocks();
    await fixture.cleanupAsync();
  }
}, 10_000);
