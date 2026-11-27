import { enableJsonOutput, printJsonOnlyOutput } from '../json';
import Log from '../../log';

jest.mock('../../log');

it('preserves explicit nulls in JSON only when requested', () => {
  const value = {
    requests: [{ id: null, startedAt: null, request: { method: 'GET', postData: null } }],
  };
  const stdoutWrite = process.stdout.write;
  try {
    enableJsonOutput();
    printJsonOnlyOutput(value);
    expect(Log.log).toHaveBeenLastCalledWith(
      JSON.stringify({ requests: [{ request: { method: 'GET' } }] }, null, 2)
    );
    printJsonOnlyOutput(value, { preserveNulls: true });
    expect(Log.log).toHaveBeenLastCalledWith(JSON.stringify(value, null, 2));
  } finally {
    process.stdout.write = stdoutWrite;
  }
});
