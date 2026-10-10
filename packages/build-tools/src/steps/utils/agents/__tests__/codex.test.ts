import { CODEX_CLI } from '../codex';
import { readFixtureLines } from './readFixture';

const format = (line: string) =>
  CODEX_CLI.formatOutputLine(line).map(({ level, message }) => ({ level, message }));

function formatFixture(name: string): ReturnType<typeof format> {
  return readFixtureLines(name).flatMap(line => format(line));
}

describe('CODEX_CLI.formatOutputLine', () => {
  it('renders a run with two tool calls and skips the thread and turn events', () => {
    expect(formatFixture('codex-tool-calls.jsonl')).toEqual([
      {
        level: 'info',
        message:
          'Agent: I will run these three operations in order and report the exact result of each.\n',
      },
      { level: 'info', message: 'Tool call: expo.sandbox_exec {"command":"echo hi"}' },
      { level: 'info', message: 'Tool result: stub ran: echo hi' },
      { level: 'info', message: 'Tool call: expo.sandbox_list {}' },
      { level: 'info', message: 'Tool result: no sandboxes' },
      {
        level: 'info',
        message:
          'Agent: The exact results, in order:\n\n1. `expo sandbox_exec` with command `echo hi`:\n   ```json\n   {"content":[{"type":"text","text":"stub ran: echo hi"}],"isError":false}\n   ```\n\n2. `expo sandbox_list`:\n   ```json\n   {"content":[{"type":"text","text":"no sandboxes"}],"isError":false}\n   ```\n\n3. `apply_patch` to create `probe.txt` with the single line `hello` failed:\n   ```text\n   patch rejected: writing is blocked by read-only sandbox; rejected by user approval settings\n   ```\n   The file was not created.',
      },
    ]);
  });

  it('renders a refused tool call as a warning', () => {
    expect(formatFixture('codex-tool-call-refused.jsonl')).toEqual([
      {
        level: 'info',
        message:
          "Agent: I will run these three operations in order and report each tool's actual result.\n",
      },
      { level: 'info', message: 'Tool call: expo.sandbox_exec {"command":"echo hi"}' },
      {
        level: 'warn',
        message: 'Tool error: MCP tool call requires approval, but approval policy is never',
      },
      {
        level: 'info',
        message: expect.stringMatching(
          /^Agent: 1\. Called `sandbox_exec` on the `expo` MCP server/
        ),
      },
    ]);
  });

  it('renders a failed turn with its transient errors as warnings and the final one as an error', () => {
    const reconnecting = (attempt: number): { level: 'warn'; message: string } => ({
      level: 'warn',
      message: `Error: Reconnecting... ${attempt}/5 (workspace routing discovery unauthorized (401))`,
    });
    expect(formatFixture('codex-failed-turn.jsonl')).toEqual([
      reconnecting(2),
      reconnecting(3),
      reconnecting(4),
      reconnecting(5),
      {
        level: 'warn',
        message:
          'Error: Falling back from WebSockets to HTTPS transport. workspace routing discovery unauthorized (401)',
      },
      reconnecting(1),
      reconnecting(2),
      reconnecting(3),
      reconnecting(4),
      reconnecting(5),
      { level: 'warn', message: 'Error: workspace routing discovery unauthorized (401)' },
      { level: 'error', message: 'Agent failed: workspace routing discovery unauthorized (401)' },
    ]);
  });

  it('renders an agent message once, when it completes', () => {
    const item = {
      id: 'item_1',
      type: 'agent_message',
      text: 'Hello',
    };
    expect(format(JSON.stringify({ type: 'item.started', item }))).toEqual([]);
    expect(format(JSON.stringify({ type: 'item.completed', item }))).toEqual([
      { level: 'info', message: 'Agent: Hello' },
    ]);
  });

  it('skips what it does not know without failing', () => {
    expect(format(JSON.stringify({ type: 'turn.completed', usage: {} }))).toEqual([]);
    expect(
      format(
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'item_1', type: 'reasoning', text: 'Thinking.' },
        })
      )
    ).toEqual([]);
    expect(format(JSON.stringify({ type: 'item.completed', item: 'bad' }))).toEqual([]);
    expect(format(JSON.stringify({ type: 'error', message: 42 }))).toEqual([]);
    expect(format('true')).toEqual([]);
  });

  it('passes a line that is not JSON through as it is', () => {
    expect(format('thread panicked')).toEqual([{ level: 'info', message: 'thread panicked' }]);
  });
});
