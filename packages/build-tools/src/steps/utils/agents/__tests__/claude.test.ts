import { CLAUDE_CODE_CLI } from '../claude';
import { readFixtureLines } from './readFixture';

const format = (line: string) =>
  CLAUDE_CODE_CLI.formatOutputLine(line).map(({ level, message }) => ({ level, message }));

function formatFixture(name: string): ReturnType<typeof format> {
  return readFixtureLines(name).flatMap(line => format(line));
}

describe('CLAUDE_CODE_CLI.formatOutputLine', () => {
  it('renders tool activity and keeps other events with generic messages', () => {
    expect(formatFixture('claude-code-tool-call.jsonl')).toEqual([
      { level: 'info', message: 'MCP server expo is connected.' },
      { level: 'info', message: 'Agent event: system' },
      { level: 'info', message: 'Agent event: system' },
      { level: 'info', message: 'Agent event: assistant' },
      { level: 'info', message: 'Tool call: mcp__expo__sandbox_exec {"command":"echo hi"}' },
      { level: 'info', message: 'Tool result: stub ran: echo hi' },
      { level: 'info', message: 'Agent event: system' },
      { level: 'info', message: 'Agent event: system' },
      { level: 'info', message: 'Agent event: assistant' },
      {
        level: 'info',
        message:
          'Agent: The command returned exactly: `stub ran: echo hi`\n\nThe tools I can call are:\n\n1. `mcp__expo__sandbox_exec` — Execute a shell command in a running sandbox\n2. `mcp__expo__sandbox_list` — List the sandboxes of the project',
      },
      { level: 'info', message: 'Agent event: result' },
    ]);
  });

  it('renders a run that failed before it could do anything', () => {
    expect(formatFixture('claude-code-not-logged-in.jsonl')).toEqual([
      { level: 'info', message: 'MCP server expo is connected.' },
      { level: 'info', message: 'Agent: Not logged in · Please run /login' },
      { level: 'error', message: 'Agent failed: Not logged in · Please run /login' },
    ]);
  });

  it('reports every MCP server, warning about one the agent could not connect to', () => {
    const event = {
      type: 'system',
      subtype: 'init',
      mcp_servers: [
        { name: 'expo', status: 'failed' },
        { name: 'other', status: 'connected' },
      ],
    };
    expect(format(JSON.stringify(event))).toEqual([
      { level: 'warn', message: 'MCP server expo is not connected (failed).' },
      { level: 'info', message: 'MCP server other is connected.' },
    ]);
  });

  it('renders a failed tool result as a warning and joins its text blocks', () => {
    const event = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            is_error: true,
            content: [
              { type: 'text', text: 'first' },
              { type: 'image', source: {} },
              { type: 'text', text: 'second' },
            ],
          },
        ],
      },
    };
    expect(format(JSON.stringify(event))).toEqual([
      { level: 'warn', message: 'Tool error: first\nsecond' },
    ]);
  });

  it('describes a failure without a result text by its errors, then by its subtype', () => {
    expect(
      format(
        JSON.stringify({
          type: 'result',
          subtype: 'error_max_turns',
          is_error: true,
          errors: ['Reached max turns (1)'],
        })
      )
    ).toEqual([{ level: 'error', message: 'Agent failed: Reached max turns (1)' }]);
    expect(
      format(
        JSON.stringify({
          type: 'result',
          subtype: 'error_max_turns',
          is_error: true,
          result: '',
          errors: ['Reached max turns (1)'],
        })
      )
    ).toEqual([{ level: 'error', message: 'Agent failed: Reached max turns (1)' }]);
    expect(
      format(
        JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, errors: [] })
      )
    ).toEqual([{ level: 'error', message: 'Agent failed: error_max_turns' }]);
    expect(
      format(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true }))
    ).toEqual([{ level: 'error', message: 'Agent failed: error_during_execution' }]);
  });

  it('keeps unrecognized typed events with a generic log message', () => {
    for (const event of [
      { type: 'rate_limit_event', rate_limit_info: {} },
      { type: 'stream_event', event: {} },
      { type: 'assistant', message: { content: 'text' } },
      { type: 'user', message: { content: 'the prompt' } },
      { type: 'result', subtype: 'success', is_error: 'yes' },
    ]) {
      expect(format(JSON.stringify(event))).toEqual([
        { level: 'info', message: `Agent event: ${event.type}` },
      ]);
    }
    expect(format('null')).toEqual([]);
    expect(format('[]')).toEqual([]);
    expect(format('true')).toEqual([]);
  });

  it('keeps the known blocks of a message with an unknown block', () => {
    const event = {
      type: 'assistant',
      message: {
        content: [
          { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} },
          { type: 'text', text: 'Searching.' },
          { type: 'tool_use', id: 'toolu_1', name: 'mcp__expo__sandbox_list', input: 'bad' },
        ],
      },
    };
    expect(format(JSON.stringify(event))).toEqual([
      { level: 'info', message: 'Agent: Searching.' },
    ]);
  });

  it('passes a line that is not JSON through as it is', () => {
    expect(format('Error: ENOENT: no such file or directory')).toEqual([
      { level: 'info', message: 'Error: ENOENT: no such file or directory' },
    ]);
  });
});
