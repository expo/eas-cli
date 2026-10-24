import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

import { getConfig } from '@expo/config';

// Regression for #4205: EAS CLI's direct and prebuild config readers must
// both handle TypeScript app.config.ts with the currently bundled dependencies.
describe('bundled Expo config can load TypeScript app.config.ts', () => {
  function withConfigFile(content: string, check: (directory: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-config-ts-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'minimal', version: '1.2.3' })
      );
      fs.writeFileSync(path.join(dir, 'app.config.ts'), content);
      check(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('loads an ordinary TypeScript config through the EAS CLI config dependency', () => {
    withConfigFile(
      "export default ({ config }: { config: Record<string, unknown> }) => ({ ...config, name: 'Minimal', slug: 'minimal' });",
      dir => {
        const { exp } = getConfig(dir, { skipSDKVersionRequirement: true });
        expect(exp.name).toBe('Minimal');
      }
    );
  });

  it('loads import.meta through the config dependency resolved by prebuild-config', () => {
    const fromPrebuild = createRequire(require.resolve('@expo/prebuild-config/package.json'));
    const { getConfig: getPrebuildConfig } = fromPrebuild(
      '@expo/config'
    ) as typeof import('@expo/config');

    withConfigFile(
      `import { createRequire } from 'node:module';
const load = createRequire(import.meta.url ?? __filename);
const { version } = load('./package.json');
export default ({ config }: { config: Record<string, unknown> }) => ({
  ...config, name: 'Minimal', slug: 'minimal', version,
});`,
      dir => {
        const { exp } = getPrebuildConfig(dir, { skipSDKVersionRequirement: true });
        expect(exp.name).toBe('Minimal');
        expect(exp.version).toBe('1.2.3');
      }
    );
  });
});
