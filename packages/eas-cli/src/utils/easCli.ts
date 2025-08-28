import { argv } from 'node:process';

const packageJSON = require('../../package.json');

export const easCliVersion: string = packageJSON.version;
export const easCliBin: string = argv[1];
