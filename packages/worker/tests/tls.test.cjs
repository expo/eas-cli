const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const tlsDirectory = path.join(__dirname, '../bin/tls');
const fixtures = path.join(__dirname, 'fixtures/tls');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-tls-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function verify(bundle, chain) {
  return execFileSync(
    'openssl',
    [
      'verify',
      '-no_check_time',
      '-no-CApath',
      '-no-CAstore',
      '-CAfile',
      bundle,
      '-untrusted',
      chain,
      chain,
    ],
    { stdio: 'pipe' }
  );
}

test('rejects all 12 published affected chains after replacing trust', t => {
  const directory = temporary(t);
  const baseline = path.join(directory, 'before.pem');
  const roots = JSON.parse(fs.readFileSync(path.join(fixtures, 'roots.json')));
  fs.writeFileSync(baseline, roots.map(root => root.pem).join('\n'));
  const chains = fs.readdirSync(fixtures).filter(name => name.endsWith('.pem'));
  assert.equal(chains.length, 12);
  for (const name of chains) {
    const chain = path.join(fixtures, name);
    verify(baseline, chain);
    assert.throws(
      () => verify(path.join(tlsDirectory, 'ca.pem'), chain),
      error =>
        error.status !== 0 && /unable to get local issuer certificate/.test(String(error.stderr))
    );
  }
});

test('preserves Java entries and backups, and stops on an unsupported blocklist', t => {
  const directory = temporary(t);
  const original = `Algorithm=SHA-256\n${'A'.repeat(64)}`;
  const paths = [
    'jdk17/lib/security/blocked.certs',
    'jdk8/jre/lib/security/blacklisted.certs',
    'jdk17.jdk/Contents/Home/lib/security/blocked.certs',
    'jdk8.jdk/Contents/Home/jre/lib/security/blacklisted.certs',
  ].map(relative => path.join(directory, relative));
  for (const blocklist of paths) {
    fs.mkdirSync(path.dirname(blocklist), { recursive: true });
    fs.writeFileSync(blocklist, original);
  }
  const script = path.join(tlsDirectory, 'block-java-certificates.sh');
  execFileSync('/bin/bash', [script, directory]);
  const first = paths.map(blocklist => fs.readFileSync(blocklist, 'utf8'));
  for (const [index, blocklist] of paths.entries()) {
    assert.equal(fs.readFileSync(`${blocklist}.before-eas-tls-policy`, 'utf8'), original);
    assert.ok(first[index].startsWith(`${original}\n`));
    assert.ok(
      first[index].includes('42C4ACCD12C4F59597925E1A08A7A90102608543809308D50EC427E118BA1493\n')
    );
  }
  execFileSync('/bin/bash', [script, directory]);
  assert.deepEqual(
    paths.map(blocklist => fs.readFileSync(blocklist, 'utf8')),
    first
  );
  fs.writeFileSync(paths[0], 'Algorithm=SHA-1\n');
  assert.throws(
    () => execFileSync('/bin/bash', [script, directory], { stdio: 'pipe' }),
    error => /Unsupported Java blocklist/.test(String(error.stderr))
  );
});

test(
  'the packaged worker uses the CA bundle at Node startup and stops on setup failure',
  { timeout: 20000 },
  async t => {
    const directory = temporary(t);
    const worker = path.join(directory, 'packages/worker');
    fs.cpSync(path.join(__dirname, '../bin'), path.join(worker, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(worker, 'dist'));
    const entry = path.join(directory, 'src/services/worker/dist/main.js');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.symlinkSync('../../../../packages/worker/bin/bootstrap.cjs', entry);
    const certificate = path.join(directory, 'local.pem');
    const key = path.join(directory, 'local.key');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
        '-keyout',
        key,
        '-out',
        certificate,
      ],
      { stdio: 'pipe' }
    );
    const caPath = path.join(worker, 'bin/tls/ca.pem');
    fs.appendFileSync(caPath, fs.readFileSync(certificate));
    const server = https.createServer(
      { key: fs.readFileSync(key), cert: fs.readFileSync(certificate) },
      (_request, response) => response.end('trusted')
    );
    t.after(() => server.close());
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    // Do not change the test host's JDKs or invoke real sudo. Java writes have their own test above.
    const javaHook = path.join(worker, 'bin/tls/block-java-certificates.sh');
    fs.writeFileSync(javaHook, '#!/bin/bash\nexit 0\n');
    const commands = path.join(directory, 'commands');
    fs.mkdirSync(commands);
    fs.writeFileSync(
      path.join(commands, 'sudo'),
      '#!/bin/bash\n[ "$1" = -n ] || exit 90\nshift\nexec "$@"\n',
      { mode: 0o755 }
    );
    const loaded = path.join(directory, 'worker-loaded');
    fs.writeFileSync(
      path.join(worker, 'dist/main.js'),
      `
    require('node:fs').writeFileSync(${JSON.stringify(loaded)}, 'yes');
    require('node:https').get('https://127.0.0.1:${server.address().port}', response => {
      response.resume(); response.on('end', () => {
        console.log(JSON.stringify({ file: process.env.SSL_CERT_FILE, options: process.env.NODE_OPTIONS }));
      });
    }).on('error', error => { console.error(error.code); process.exitCode = 1; });
  `
    );
    async function runAsync(extra = {}) {
      const child = spawn(process.execPath, [entry], {
        env: {
          ...process.env,
          ENVIRONMENT: 'staging',
          NODE_OPTIONS: '--max-old-space-size=512',
          NODE_EXTRA_CA_CERTS: '',
          PATH: `${commands}:${process.env.PATH}`,
          ...extra,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', data => {
        stdout += data;
      });
      child.stderr.on('data', data => {
        stderr += data;
      });
      const [code] = await once(child, 'close');
      return { code, stdout, stderr };
    }
    const success = await runAsync();
    assert.equal(success.code, 0, success.stderr);
    assert.deepEqual(JSON.parse(success.stdout), {
      file: fs.realpathSync(caPath),
      options: '--max-old-space-size=512 --use-openssl-ca',
    });
    // The same endpoint must fail when its independent test CA is removed.
    fs.copyFileSync(path.join(tlsDirectory, 'ca.pem'), caPath);
    const denied = await runAsync();
    assert.equal(denied.code, 1);
    assert.match(denied.stderr, /DEPTH_ZERO_SELF_SIGNED_CERT/);

    fs.rmSync(loaded);
    const conflict = await runAsync({ NODE_OPTIONS: '--use-bundled-ca' });
    assert.notEqual(conflict.code, 0);
    assert.match(conflict.stderr, /Conflicting Node CA options/);
    assert.equal(fs.existsSync(loaded), false);
    fs.writeFileSync(javaHook, '#!/bin/bash\nexit 41\n');
    const failure = await runAsync();
    assert.equal(failure.code, 41);
    assert.equal(fs.existsSync(loaded), false);
  }
);
