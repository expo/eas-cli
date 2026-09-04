import { SandboxCommandExecutor } from '../sandboxCommandExecutor';

describe(SandboxCommandExecutor.name, () => {
  let executor: SandboxCommandExecutor;

  beforeEach(() => {
    executor = new SandboxCommandExecutor(process.cwd());
  });

  afterEach(() => {
    executor.stop();
  });

  it('returns output and the exit code for a completed command', async () => {
    const result = await executor.execCommandAsync({ cmd: 'printf hello' });

    expect(result).toMatchObject({ output: 'hello', exit_code: 0 });
    expect(result.session_id).toBeUndefined();
  });

  it('returns a session id and accepts stdin for a running command', async () => {
    const started = await executor.execCommandAsync({
      cmd: `node -e "process.stdin.once('data', data => process.stdout.write(data.toString().toUpperCase(), () => process.exit(0)))"`,
      yield_time_ms: 10,
    });

    expect(started.session_id).toEqual(expect.any(Number));
    const completed = await executor.writeStdinAsync({
      session_id: started.session_id,
      chars: 'hello',
      yield_time_ms: 1_000,
    });

    expect(completed).toMatchObject({ output: 'HELLO', exit_code: 0 });
    expect(completed.session_id).toBeUndefined();
  });

  it('returns only output produced since the previous call', async () => {
    const started = await executor.execCommandAsync({
      cmd: `node -e "console.log('first'); setTimeout(() => console.log('second'), 100)"`,
      yield_time_ms: 50,
    });

    expect(started).toMatchObject({ output: 'first\n', session_id: expect.any(Number) });
    const completed = await executor.writeStdinAsync({
      session_id: started.session_id,
      yield_time_ms: 1_000,
    });

    expect(completed).toMatchObject({ output: 'second\n', exit_code: 0 });
  });
});
