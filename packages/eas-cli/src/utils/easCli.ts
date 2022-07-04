import fs from 'fs-extra';

const packageJSON = await fs.readJSON('../../package.json');

export const easCliVersion: string = packageJSON.version;
