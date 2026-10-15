#!/usr/bin/env node
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const role = process.argv[2] === 'install' ? 'parent' : process.argv[2];
const pidFile = path.join(__dirname, `${role}.pid`);
fs.writeFileSync(`${pidFile}.tmp`, String(process.pid));
fs.renameSync(`${pidFile}.tmp`, pidFile);

if (role !== 'grandchild') {
  spawn(process.execPath, [__filename, role === 'parent' ? 'child' : 'grandchild'], {
    stdio: 'inherit',
  });
}

process.stdout.write(`${role}-ready\n`);
setInterval(() => {}, 1000);
