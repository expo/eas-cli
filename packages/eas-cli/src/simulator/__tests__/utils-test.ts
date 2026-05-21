import { vol } from 'memfs';
import os from 'node:os';
import YAML from 'yaml';

import { applyArgentEdits, captureWritableArgentEdits, revertArgentEdits } from '../utils';

jest.mock('fs');
// __mocks__/fs.ts only intercepts the bare `'fs'` specifier; the source uses
// `import fs from 'node:fs'`, so we have to redirect that to the mocked one
// here as well. Keep both lines.
jest.mock('node:fs', () => require('fs'));
jest.mock('../../log');

const HOME = '/home/test';
const CWD = '/home/test/project';

beforeEach(() => {
  vol.reset();
  jest.spyOn(os, 'homedir').mockReturnValue(HOME);
  jest.spyOn(process, 'cwd').mockReturnValue(CWD);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function readFile(filePath: string): string {
  return vol.readFileSync(filePath, 'utf8') as string;
}

describe('captureWritableArgentEdits', () => {
  it('returns empty when no MCP configs exist', () => {
    expect(captureWritableArgentEdits()).toEqual([]);
  });

  it('captures a Claude Code project JSON config', () => {
    vol.fromJSON({
      [`${CWD}/.mcp.json`]: JSON.stringify(
        {
          mcpServers: {
            argent: { command: 'argent', args: ['mcp'], env: {} },
          },
        },
        null,
        2
      ),
    });

    expect(captureWritableArgentEdits()).toEqual([
      {
        filePath: `${CWD}/.mcp.json`,
        editorLabel: 'Claude Code',
        scope: 'project',
        format: 'json',
        toolsUrlKeyPath: ['mcpServers', 'argent', 'env', 'ARGENT_TOOLS_URL'],
        previousValue: null,
      },
    ]);
  });

  it('captures the previousValue when ARGENT_TOOLS_URL is already set', () => {
    vol.fromJSON({
      [`${CWD}/.mcp.json`]: JSON.stringify({
        mcpServers: {
          argent: { env: { ARGENT_TOOLS_URL: 'https://old.example.com' } },
        },
      }),
    });

    const edits = captureWritableArgentEdits();
    expect(edits[0].previousValue).toBe('https://old.example.com');
  });

  it('uses servers.argent (not mcpServers.argent) for VS Code configs', () => {
    vol.fromJSON({
      [`${CWD}/.vscode/mcp.json`]: JSON.stringify({
        servers: { argent: { env: {} } },
      }),
    });

    const edits = captureWritableArgentEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0].editorLabel).toBe('VS Code');
    expect(edits[0].toolsUrlKeyPath).toEqual(['servers', 'argent', 'env', 'ARGENT_TOOLS_URL']);
  });

  it('captures a Zed JSONC config with surrounding comments', () => {
    vol.fromJSON({
      [`${HOME}/.config/zed/settings.json`]: `// User settings
{
  // MCP servers
  "context_servers": {
    "argent": { "command": "argent", "args": ["mcp"], "env": {} }
  }
}
`,
    });

    const edits = captureWritableArgentEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      editorLabel: 'Zed',
      scope: 'global',
      format: 'jsonc',
      toolsUrlKeyPath: ['context_servers', 'argent', 'env', 'ARGENT_TOOLS_URL'],
      previousValue: null,
    });
  });

  it('uses mcp.argent.environment (not env) for opencode configs', () => {
    vol.fromJSON({
      [`${CWD}/opencode.json`]: JSON.stringify({
        mcp: {
          argent: {
            type: 'local',
            command: ['argent', 'mcp'],
            enabled: true,
            environment: { ARGENT_MCP_LOG: '/tmp/foo' },
          },
        },
      }),
    });

    const edits = captureWritableArgentEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      editorLabel: 'opencode',
      format: 'jsonc',
      toolsUrlKeyPath: ['mcp', 'argent', 'environment', 'ARGENT_TOOLS_URL'],
    });
  });

  it('captures a Codex TOML config', () => {
    vol.fromJSON({
      [`${HOME}/.codex/config.toml`]: `[mcp_servers.argent]
command = "argent"
args = ["mcp"]
env = { ARGENT_MCP_LOG = "/tmp/foo" }
`,
    });

    const edits = captureWritableArgentEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      editorLabel: 'Codex',
      scope: 'global',
      format: 'toml',
      toolsUrlKeyPath: ['mcp_servers', 'argent', 'env', 'ARGENT_TOOLS_URL'],
    });
  });

  it('captures a Hermes YAML config', () => {
    vol.fromJSON({
      [`${HOME}/.hermes/config.yaml`]: `mcp_servers:
  argent:
    command: argent
    args:
      - mcp
    env:
      ARGENT_TOOLS_URL: https://existing.example.com
`,
    });

    const edits = captureWritableArgentEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      editorLabel: 'Hermes',
      format: 'yaml',
      previousValue: 'https://existing.example.com',
    });
  });

  it('skips files whose argent entry is absent', () => {
    vol.fromJSON({
      [`${CWD}/.mcp.json`]: JSON.stringify({ mcpServers: { other: {} } }),
    });

    expect(captureWritableArgentEdits()).toEqual([]);
  });

  it('skips files with unparseable JSON', () => {
    vol.fromJSON({
      [`${CWD}/.mcp.json`]: 'not json at all',
    });

    expect(captureWritableArgentEdits()).toEqual([]);
  });

  it('dedupes opencode by (editor, scope) when multiple filenames coexist', () => {
    const opencodeBody = JSON.stringify({
      mcp: { argent: { environment: {} } },
    });
    vol.fromJSON({
      [`${CWD}/opencode.jsonc`]: opencodeBody,
      [`${CWD}/opencode.json`]: opencodeBody,
    });

    const edits = captureWritableArgentEdits();
    expect(edits).toHaveLength(1);
    // Argent's installer prioritizes opencode.jsonc over opencode.json.
    expect(edits[0].filePath).toBe(`${CWD}/opencode.jsonc`);
  });

  it('reports both project and global Claude Code configs independently', () => {
    const body = JSON.stringify({ mcpServers: { argent: { env: {} } } });
    vol.fromJSON({
      [`${CWD}/.mcp.json`]: body,
      [`${HOME}/.claude.json`]: body,
    });

    const edits = captureWritableArgentEdits();
    expect(edits.map(e => e.scope).sort()).toEqual(['global', 'project']);
  });
});

describe('applyArgentEdits + revertArgentEdits', () => {
  const NEW_URL = 'https://new.trycloudflare.com';

  it('writes to JSON preserving 2-space indent and trailing newline', () => {
    const original =
      JSON.stringify(
        {
          mcpServers: {
            argent: { command: 'argent', args: ['mcp'], env: {} },
          },
        },
        null,
        2
      ) + '\n';
    vol.fromJSON({ [`${CWD}/.mcp.json`]: original });

    const edits = captureWritableArgentEdits();
    applyArgentEdits(edits, NEW_URL);

    const written = readFile(`${CWD}/.mcp.json`);
    expect(JSON.parse(written).mcpServers.argent.env.ARGENT_TOOLS_URL).toBe(NEW_URL);
    // Preserves 2-space indent and trailing newline.
    expect(written).toMatch(/^\{\n {2}"mcpServers"/);
    expect(written.endsWith('\n')).toBe(true);
  });

  it('preserves JSONC comments around the touched key', () => {
    const original = `// Project Zed settings
{
  // The MCP servers section
  "context_servers": {
    /* argent — managed by argent init */
    "argent": {
      "command": "argent",
      "args": ["mcp"],
      "env": {} // log file lives here normally
    }
  }
}
`;
    vol.fromJSON({ [`${CWD}/.zed/settings.json`]: original });

    const edits = captureWritableArgentEdits();
    applyArgentEdits(edits, NEW_URL);

    const written = readFile(`${CWD}/.zed/settings.json`);
    expect(written).toContain('// Project Zed settings');
    expect(written).toContain('// The MCP servers section');
    expect(written).toContain('/* argent — managed by argent init */');
    expect(written).toContain('// log file lives here normally');
    expect(written).toContain(`"ARGENT_TOOLS_URL": "${NEW_URL}"`);
  });

  it('preserves YAML comments around the touched key', () => {
    const original = `# Hermes config
mcp_servers:
  # argent MCP server
  argent:
    command: argent
    args:
      - mcp
    env:
      ARGENT_MCP_LOG: /tmp/argent.log # log path
`;
    vol.fromJSON({ [`${HOME}/.hermes/config.yaml`]: original });

    const edits = captureWritableArgentEdits();
    applyArgentEdits(edits, NEW_URL);

    const written = readFile(`${HOME}/.hermes/config.yaml`);
    expect(written).toContain('# Hermes config');
    expect(written).toContain('# argent MCP server');
    expect(written).toContain('# log path');
    expect(written).toContain(NEW_URL);
  });

  it('handles a YAML config whose argent entry has no env block yet', () => {
    // Hermes hits the YAML driver, which uses Document.setIn — verify it can
    // create the intermediate env block on the fly (analogous to JSON's
    // setNestedValue but exercising the yaml lib's behavior).
    const original = `mcp_servers:
  argent:
    command: argent
    args:
      - mcp
`;
    vol.fromJSON({ [`${HOME}/.hermes/config.yaml`]: original });

    const edits = captureWritableArgentEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0].previousValue).toBeNull();

    applyArgentEdits(edits, NEW_URL);
    const afterApply = YAML.parse(readFile(`${HOME}/.hermes/config.yaml`));
    expect(afterApply.mcp_servers.argent.env.ARGENT_TOOLS_URL).toBe(NEW_URL);

    revertArgentEdits(edits);
    const afterRevert = YAML.parse(readFile(`${HOME}/.hermes/config.yaml`));
    // The key we set should be gone after revert (the env block itself may
    // linger as an empty map — that's harmless and not what we're testing).
    expect(afterRevert.mcp_servers.argent?.env?.ARGENT_TOOLS_URL).toBeUndefined();
  });

  it('writes the new value to a Codex TOML config (round-trip is lossy)', () => {
    const original = `[mcp_servers.argent]
command = "argent"
args = ["mcp"]
env = { ARGENT_MCP_LOG = "/tmp/log" }
`;
    vol.fromJSON({ [`${HOME}/.codex/config.toml`]: original });

    const edits = captureWritableArgentEdits();
    applyArgentEdits(edits, NEW_URL);

    const written = readFile(`${HOME}/.codex/config.toml`);
    expect(written).toContain(NEW_URL);
    expect(written).toContain('ARGENT_TOOLS_URL');
  });

  it('reverts back to null (removes the key) when there was no previous value', () => {
    const original = JSON.stringify({ mcpServers: { argent: { env: {} } } }, null, 2);
    vol.fromJSON({ [`${CWD}/.mcp.json`]: original });

    const edits = captureWritableArgentEdits();
    expect(edits[0].previousValue).toBeNull();

    applyArgentEdits(edits, NEW_URL);
    revertArgentEdits(edits);

    const after = JSON.parse(readFile(`${CWD}/.mcp.json`));
    expect(after.mcpServers.argent.env).not.toHaveProperty('ARGENT_TOOLS_URL');
  });

  it('reverts back to the prior string when ARGENT_TOOLS_URL was already set', () => {
    const PREVIOUS_URL = 'https://old.trycloudflare.com';
    vol.fromJSON({
      [`${CWD}/.mcp.json`]: JSON.stringify({
        mcpServers: { argent: { env: { ARGENT_TOOLS_URL: PREVIOUS_URL } } },
      }),
    });

    const edits = captureWritableArgentEdits();
    expect(edits[0].previousValue).toBe(PREVIOUS_URL);

    applyArgentEdits(edits, NEW_URL);
    expect(JSON.parse(readFile(`${CWD}/.mcp.json`)).mcpServers.argent.env.ARGENT_TOOLS_URL).toBe(
      NEW_URL
    );

    revertArgentEdits(edits);
    expect(JSON.parse(readFile(`${CWD}/.mcp.json`)).mcpServers.argent.env.ARGENT_TOOLS_URL).toBe(
      PREVIOUS_URL
    );
  });

  it('applies multiple edits and reverts each independently', () => {
    vol.fromJSON({
      [`${CWD}/.mcp.json`]: JSON.stringify({
        mcpServers: { argent: { env: { ARGENT_TOOLS_URL: 'https://prev.example.com' } } },
      }),
      [`${HOME}/.cursor/mcp.json`]: JSON.stringify({
        mcpServers: { argent: { env: {} } },
      }),
    });

    const edits = captureWritableArgentEdits();
    expect(edits).toHaveLength(2);
    applyArgentEdits(edits, NEW_URL);

    expect(JSON.parse(readFile(`${CWD}/.mcp.json`)).mcpServers.argent.env.ARGENT_TOOLS_URL).toBe(
      NEW_URL
    );
    expect(
      JSON.parse(readFile(`${HOME}/.cursor/mcp.json`)).mcpServers.argent.env.ARGENT_TOOLS_URL
    ).toBe(NEW_URL);

    revertArgentEdits(edits);

    expect(JSON.parse(readFile(`${CWD}/.mcp.json`)).mcpServers.argent.env.ARGENT_TOOLS_URL).toBe(
      'https://prev.example.com'
    );
    expect(
      JSON.parse(readFile(`${HOME}/.cursor/mcp.json`)).mcpServers.argent.env
    ).not.toHaveProperty('ARGENT_TOOLS_URL');
  });

  it("revert is a no-op when the file's argent entry no longer has env (user moved it)", () => {
    vol.fromJSON({
      [`${CWD}/.mcp.json`]: JSON.stringify({
        mcpServers: { argent: { env: {} } },
      }),
    });
    const edits = captureWritableArgentEdits();
    applyArgentEdits(edits, NEW_URL);

    // Simulate the user deleting the env block between apply and revert.
    vol.writeFileSync(`${CWD}/.mcp.json`, JSON.stringify({ mcpServers: { argent: {} } }));

    expect(() => revertArgentEdits(edits)).not.toThrow();
    expect(JSON.parse(readFile(`${CWD}/.mcp.json`))).toEqual({
      mcpServers: { argent: {} },
    });
  });

  it('rolls back already-written edits when a later write fails', () => {
    const claudeOriginal = JSON.stringify({ mcpServers: { argent: { env: {} } } }, null, 2);
    const cursorOriginal = JSON.stringify({ mcpServers: { argent: { env: {} } } }, null, 2);
    vol.fromJSON({
      [`${CWD}/.mcp.json`]: claudeOriginal,
      [`${HOME}/.cursor/mcp.json`]: cursorOriginal,
    });

    const edits = captureWritableArgentEdits();
    expect(edits).toHaveLength(2);

    // Make the SECOND writeFileSync throw. The first edit applies; the
    // catch-and-rethrow path in applyArgentEdits then has to revert the first
    // one before the throw escapes.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsMod = require('node:fs') as typeof import('node:fs');
    const realWrite = fsMod.writeFileSync.bind(fsMod);
    let writeCount = 0;
    jest.spyOn(fsMod, 'writeFileSync').mockImplementation(((path: string, data: string) => {
      writeCount += 1;
      if (writeCount === 2) {
        throw new Error('disk full');
      }
      realWrite(path, data);
    }) as typeof fsMod.writeFileSync);

    expect(() => applyArgentEdits(edits, NEW_URL)).toThrow('disk full');

    // Both files should look like they did before the apply ran.
    expect(JSON.parse(readFile(`${CWD}/.mcp.json`))).toEqual(JSON.parse(claudeOriginal));
    expect(JSON.parse(readFile(`${HOME}/.cursor/mcp.json`))).toEqual(JSON.parse(cursorOriginal));
  });

  it('routes per-file failures to the onError callback and keeps going', () => {
    vol.fromJSON({
      [`${CWD}/.mcp.json`]: JSON.stringify({
        mcpServers: { argent: { env: {} } },
      }),
      [`${HOME}/.cursor/mcp.json`]: JSON.stringify({
        mcpServers: { argent: { env: {} } },
      }),
    });

    const edits = captureWritableArgentEdits();
    applyArgentEdits(edits, NEW_URL);

    // Drop one file before revert to force a failure on that path.
    vol.unlinkSync(`${CWD}/.mcp.json`);

    const errors: Array<{ filePath: string; error: unknown }> = [];
    revertArgentEdits(edits, (filePath, error) => {
      errors.push({ filePath, error });
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].filePath).toBe(`${CWD}/.mcp.json`);
    // The other file still reverted cleanly.
    expect(
      JSON.parse(readFile(`${HOME}/.cursor/mcp.json`)).mcpServers.argent.env
    ).not.toHaveProperty('ARGENT_TOOLS_URL');
  });
});
