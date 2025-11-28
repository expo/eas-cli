import fs from 'fs';
import path from 'path';

import * as esbuild from 'esbuild';

/**
 * esbuild plugin transforming `__dirname` and `__filename`
 * to concrete values. We use `__dirname` in `eas-build`
 * to resolve paths to templates and executables (e.g. `bin/set-env`)
 * and we expect them to be script directory (this plugin),
 * not single worker bundle directory (esbuild).
 * Adapted from https://github.com/evanw/esbuild/issues/859#issuecomment-829154955
 */
const dirnamePlugin: esbuild.Plugin = {
  name: 'dirname',
  setup(build) {
    build.onLoad({ filter: /.*/ }, ({ path: filePath }) => {
      let contents = fs.readFileSync(filePath, 'utf8');
      let loader = path.extname(filePath).substring(1);
      // mjs and cjs files should be loaded with the regular js loader
      if (loader === 'mjs' || loader === 'cjs') {
        loader = 'js';
      }
      const dirname = path.relative(__dirname, path.dirname(filePath));
      contents = contents
        .replace('__dirname', `"${dirname}"`)
        .replace('__filename', `"${filePath}"`);
      return {
        contents,
        loader: loader as esbuild.Loader,
      };
    });
  },
};

void (async () => {
  try {
    const context = await esbuild.context({
      bundle: true,
      minify: true,
      tsconfig: 'tsconfig.json',
      platform: 'node',
      external: [
        'oracledb',
        'tedious',
        'mssql',
        'pg-query-stream',
        'pg-native',
        'sqlite3',
        'mysql2',
        'mysql',
        'dtrace-provider',
      ],
      entryPoints: ['src/main.ts'],
      outdir: './dist',
      plugins: [dirnamePlugin],
      logLevel: 'info',
    });

    if (!process.argv.includes('--watch')) {
      console.time('Built in');
      await context.rebuild();
      console.timeEnd('Built in');
      process.exit(0);
    }

    console.log('Starting watching...');
    await context.watch();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
