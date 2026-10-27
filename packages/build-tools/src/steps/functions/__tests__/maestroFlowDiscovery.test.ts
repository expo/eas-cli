import { vol } from 'memfs';

import { buildFlowNameToPathMap, readFlowName, walkDir } from '../maestroFlowDiscovery';
import { createMockLogger } from '../../../__tests__/utils/logger';

describe(readFlowName, () => {
  beforeEach(() => vol.reset());

  it('returns top-level `name` when present', async () => {
    vol.fromJSON({
      '/p/login.yml': `appId: com.example\nname: Login Flow\n---\n- launchApp\n`,
    });
    expect(await readFlowName('/p/login.yml')).toBe('Login Flow');
  });

  it('falls back to basename without extension when name absent', async () => {
    vol.fromJSON({ '/p/login.yml': `appId: com.example\n---\n- launchApp\n` });
    expect(await readFlowName('/p/login.yml')).toBe('login');
  });

  it('falls back when name is empty string', async () => {
    vol.fromJSON({ '/p/login.yml': `name: ""\n` });
    expect(await readFlowName('/p/login.yml')).toBe('login');
  });

  it('falls back when name is non-string', async () => {
    vol.fromJSON({ '/p/login.yml': `name: 42\n` });
    expect(await readFlowName('/p/login.yml')).toBe('login');
  });

  it('falls back when YAML is malformed', async () => {
    vol.fromJSON({ '/p/login.yml': `appId: [unclosed\n` });
    expect(await readFlowName('/p/login.yml')).toBe('login');
  });

  it('falls back when file is empty', async () => {
    vol.fromJSON({ '/p/login.yml': '' });
    expect(await readFlowName('/p/login.yml')).toBe('login');
  });

  it('falls back when file does not exist', async () => {
    expect(await readFlowName('/p/missing.yml')).toBe('missing');
  });

  it('only parses the first YAML document (commands document errors are ignored)', async () => {
    vol.fromJSON({
      '/p/login.yml': `name: Login\n---\n- this is: { malformed yaml\n`,
    });
    expect(await readFlowName('/p/login.yml')).toBe('Login');
  });

  it('handles .yaml extension', async () => {
    vol.fromJSON({ '/p/checkout.yaml': `name: Checkout\n` });
    expect(await readFlowName('/p/checkout.yaml')).toBe('Checkout');
  });

  it('handles a leading `---` document marker', async () => {
    vol.fromJSON({
      '/p/login.yml': `---\nappId: com.example\nname: Login\n---\n- launchApp\n`,
    });
    expect(await readFlowName('/p/login.yml')).toBe('Login');
  });
});

describe(walkDir, () => {
  beforeEach(() => vol.reset());

  it('collects all .yml/.yaml files recursively, sorted', async () => {
    const logger = createMockLogger();
    vol.fromJSON({
      '/p/flows/a.yml': '',
      '/p/flows/b.yaml': '',
      '/p/flows/sub/c.yml': '',
      '/p/flows/sub/d.YAML': '',
      '/p/flows/readme.md': '',
    });
    const out: string[] = [];
    await walkDir('/p/flows', new Set(), out, logger);
    expect(out.sort()).toEqual([
      '/p/flows/a.yml',
      '/p/flows/b.yaml',
      '/p/flows/sub/c.yml',
      '/p/flows/sub/d.YAML',
    ]);
  });

  it('skips files named config.yaml (case-insensitive)', async () => {
    const logger = createMockLogger();
    vol.fromJSON({
      '/p/flows/config.yaml': '',
      '/p/flows/CONFIG.yaml': '',
      '/p/flows/login.yml': '',
    });
    const out: string[] = [];
    await walkDir('/p/flows', new Set(), out, logger);
    expect(out.sort()).toEqual(['/p/flows/login.yml']);
  });

  it('returns silently when realpath fails (e.g. missing dir)', async () => {
    const logger = createMockLogger();
    const out: string[] = [];
    await walkDir('/p/missing', new Set(), out, logger);
    expect(out).toEqual([]);
  });
});

describe(buildFlowNameToPathMap, () => {
  beforeEach(() => vol.reset());

  it('builds a map from a single file input (basename name)', async () => {
    const logger = createMockLogger();
    vol.fromJSON({ '/proj/flows/login.yml': 'appId: x\n' });
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: ['flows/login.yml'],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toEqual(new Map([['login', 'flows/login.yml']]));
  });

  it('uses top-level name when present', async () => {
    const logger = createMockLogger();
    vol.fromJSON({ '/proj/flows/a.yml': 'name: Login Flow\n' });
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: ['flows/a.yml'],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toEqual(new Map([['Login Flow', 'flows/a.yml']]));
  });

  it('walks a directory input and adds each flow', async () => {
    const logger = createMockLogger();
    vol.fromJSON({
      '/proj/.maestro/login.yml': 'name: Login\n',
      '/proj/.maestro/checkout.yml': '',
      '/proj/.maestro/sub/profile.yml': '',
    });
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: ['.maestro'],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toEqual(
      new Map([
        ['Login', '.maestro/login.yml'],
        ['checkout', '.maestro/checkout.yml'],
        ['profile', '.maestro/sub/profile.yml'],
      ])
    );
  });

  it('merges file + directory inputs', async () => {
    const logger = createMockLogger();
    vol.fromJSON({
      '/proj/.maestro/a.yml': '',
      '/proj/extra/b.yml': '',
    });
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: ['.maestro', 'extra/b.yml'],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toEqual(
      new Map([
        ['a', '.maestro/a.yml'],
        ['b', 'extra/b.yml'],
      ])
    );
  });

  it('skips non-existent inputs with warn', async () => {
    const logger = createMockLogger();
    vol.fromJSON({ '/proj/flows/a.yml': '' });
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: ['flows/missing.yml', 'flows/a.yml'],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toEqual(new Map([['a', 'flows/a.yml']]));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('flows/missing.yml'));
  });

  it('skips workspace config.yaml inside directory inputs', async () => {
    const logger = createMockLogger();
    vol.fromJSON({
      '/proj/.maestro/config.yaml': 'flows:\n  - "*.yml"\n',
      '/proj/.maestro/login.yml': '',
    });
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: ['.maestro'],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toEqual(new Map([['login', '.maestro/login.yml']]));
  });

  it('does NOT skip config.yaml when passed as an explicit file input', async () => {
    const logger = createMockLogger();
    vol.fromJSON({
      '/proj/.maestro/config.yaml': 'name: Workspace Defaults\nflows:\n  - "*.yml"\n',
    });
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: ['.maestro/config.yaml'],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toEqual(new Map([['Workspace Defaults', '.maestro/config.yaml']]));
  });

  it('returns null when two files share top-level name', async () => {
    const logger = createMockLogger();
    vol.fromJSON({
      '/proj/a.yml': 'name: Login\n',
      '/proj/b.yml': 'name: Login\n',
    });
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: ['a.yml', 'b.yml'],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"Login"'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('a.yml'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('b.yml'));
  });

  it('returns null when two files share basename across directories', async () => {
    const logger = createMockLogger();
    vol.fromJSON({
      '/proj/login/index.yml': '',
      '/proj/checkout/index.yml': '',
    });
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: ['login', 'checkout'],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toBeNull();
  });

  it('returns null when name collides with another file basename', async () => {
    const logger = createMockLogger();
    vol.fromJSON({
      '/proj/login.yml': 'name: Other\n',
      '/proj/Other.yml': '',
    });
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: ['login.yml', 'Other.yml'],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toBeNull();
  });

  it('dedupes the same physical file passed via overlapping inputs', async () => {
    const logger = createMockLogger();
    vol.fromJSON({ '/proj/.maestro/login.yml': '' });
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: ['.maestro', '.maestro/login.yml'],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toEqual(new Map([['login', '.maestro/login.yml']]));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('uses absolute fallback when input file lives outside projectRoot', async () => {
    const logger = createMockLogger();
    vol.fromJSON({ '/elsewhere/a.yml': '' });
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: ['/elsewhere/a.yml'],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toEqual(new Map([['a', '/elsewhere/a.yml']]));
  });

  it('absolute directory input under projectRoot yields project-relative children', async () => {
    const logger = createMockLogger();
    vol.fromJSON({ '/proj/.maestro/a.yml': '' });
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: ['/proj/.maestro'],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toEqual(new Map([['a', '.maestro/a.yml']]));
  });

  it('returns null and warns on unexpected helper failure', async () => {
    const logger = createMockLogger();
    const map = await buildFlowNameToPathMap({
      inputFlowPaths: [Symbol('bad') as unknown as string],
      projectRoot: '/proj',
      logger,
    });
    expect(map).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('buildFlowNameToPathMap failed unexpectedly')
    );
  });
});
