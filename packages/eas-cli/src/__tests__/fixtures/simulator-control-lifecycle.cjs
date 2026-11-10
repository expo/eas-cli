const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');

const root = fs.realpathSync(process.argv[2]);
const cli = path.join(root, 'packages/eas-cli');
const cliRequire = createRequire(path.join(cli, 'package.json'));
const { oclif } = cliRequire('./package.json');
cliRequire('ts-node').register({ project: path.join(cli, 'tsconfig.json'), transpileOnly: true });
const { Config, run } = cliRequire('@oclif/core');
const EasCommand = require(path.join(cli, 'src/commandUtils/EasCommand')).default;
const Control = require(path.join(cli, 'src/commands/simulator/control')).default;
const cases = JSON.parse(process.argv[3]);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-help-lifecycle-'));
const events = [];
let commandArgs;
globalThis.__helpLifecycleEvents = events;

// Replace command work (auth/device I/O), keeping discovery, parsing and hooks real.
EasCommand.prototype.run = async function () {
  commandArgs = this.argv;
  events.push({ event: 'run', id: this.id });
};
EasCommand.prototype.finally = async function () {};

(async () => {
  try {
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'eas-help-lifecycle-fixture',
        version: '1.0.0',
        oclif: {
          bin: 'eas',
          additionalHelpFlags: ['-h'],
          helpClass: oclif.helpClass,
          commands: './commands',
          hooks: { prerun: './prerun.cjs', postrun: './postrun.cjs' },
        },
      })
    );
    for (const command of ['simulator/control', 'simulator/index', 'account/login']) {
      const file = path.join(directory, 'commands', `${command}.js`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        `exports.default = require(${JSON.stringify(path.join(cli, 'src/commands', command))}).default;`
      );
    }
    const helpFile = path.join(directory, `${oclif.helpClass}.js`);
    fs.mkdirSync(path.dirname(helpFile), { recursive: true });
    fs.writeFileSync(
      helpFile,
      `exports.default = require(${JSON.stringify(path.join(cli, 'src/help'))}).default;`
    );
    for (const event of ['prerun', 'postrun']) {
      fs.writeFileSync(
        path.join(directory, `${event}.cjs`),
        `module.exports = async function({Command}) { globalThis.__helpLifecycleEvents.push({event:${JSON.stringify(event)},id:Command.id}); };`
      );
    }
    process.env.XDG_DATA_HOME = directory;
    process.env.XDG_CACHE_HOME = directory;
    let config = await Config.load({ root: directory });
    if (process.argv[4] === 'manifest') {
      if (!config.rootPlugin.manifest.commands['simulator:control'].relativePath) {
        throw new Error('The manifest must exercise cached command module paths');
      }
      fs.writeFileSync(
        path.join(directory, 'oclif.manifest.json'),
        JSON.stringify(config.rootPlugin.manifest)
      );
      config = await Config.load({ root: directory });
    }
    const results = [];
    for (const args of cases) {
      // Published manifests discover metadata without loading the command class.
      // Clear eager discovery's assignment to exercise that cold-start boundary.
      delete Control.id;
      const start = events.length;
      commandArgs = undefined;
      const write = process.stdout.write;
      let stdout = '',
        error;
      process.stdout.write = (chunk, encoding, callback) => {
        stdout += String(chunk);
        const done = typeof encoding === 'function' ? encoding : callback;
        done?.();
        return true;
      };
      try {
        await run(args, config);
      } catch (err) {
        error = err.message;
      } finally {
        process.stdout.write = write;
      }
      results.push({ stdout, events: events.slice(start), error, commandArgs });
    }
    console.log('LIFECYCLE_RESULT ' + JSON.stringify(results));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
