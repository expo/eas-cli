import { codeFrameColumns } from '@babel/code-frame';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
import * as fleece from 'golden-fleece';
import path from 'path';

import { InvalidEasJsonError, MissingEasJsonError } from './errors';
import { EasJsonSchema } from './schema';
import { EasJson } from './types';

export class EasJsonAccessor {
  private easJsonPath: string;

  private isJson5 = false;
  private easJson: EasJson | undefined;
  private easJsonRawContents: string | undefined;
  private easJsonRawObject: any | undefined;
  private easJsonPatched: boolean = false;

  constructor(projectDir: string) {
    this.easJsonPath = EasJsonAccessor.formatEasJsonPath(projectDir);
  }

  public static formatEasJsonPath(projectDir: string): string {
    return path.join(projectDir, 'eas.json');
  }

  public async readAsync(): Promise<EasJson> {
    if (this.easJson) {
      return this.easJson;
    }

    const rawJSON = await this.readRawJsonAsync();
    const { value, error } = EasJsonSchema.validate(rawJSON, {
      allowUnknown: false,
      abortEarly: false,
      convert: true,
      noDefaults: true,
    });
    if (error) {
      const errorMessages = error.message.split('. ');
      throw new InvalidEasJsonError(
        `${chalk.bold('eas.json')} is not valid.\n- ${errorMessages.join('\n- ')}`
      );
    }
    this.easJson = value;
    return value;
  }

  public async writeAsync(): Promise<void> {
    if (!this.easJsonPatched) {
      return;
    }
    await fs.writeFile(this.easJsonPath, this.easJsonRawContents);
    this.resetState();
  }

  public patch(fn: (easJsonRawObject: any) => any): void {
    assert(
      this.easJsonRawContents && this.easJsonRawObject,
      'call readAsync/readRawJsonAsync first'
    );

    this.easJsonRawObject = fn(this.easJsonRawObject);
    if (this.isJson5) {
      this.easJsonRawContents = fleece.patch(this.easJsonRawContents, this.easJsonRawObject);
    } else {
      this.easJsonRawContents = `${JSON.stringify(this.easJsonRawObject, null, 2)}\n`;
    }
    this.easJsonPatched = true;
  }

  public async readRawJsonAsync(): Promise<any> {
    if (!(await fs.pathExists(this.easJsonPath))) {
      throw new MissingEasJsonError(
        `${chalk.bold('eas.json')} could not be found at ${
          this.easJsonPath
        }. Learn more at https://expo.fyi/eas-json`
      );
    }

    this.easJsonRawContents = await fs.readFile(this.easJsonPath, 'utf-8');

    if (this.easJsonRawContents.trim().length === 0) {
      throw new InvalidEasJsonError(`${chalk.bold('eas.json')} is empty.`);
    }

    try {
      const rawJSON = JSON.parse(this.easJsonRawContents);
      this.easJsonRawObject = rawJSON;
      return rawJSON;
    } catch {
      // ignore error, try reading as JSON5
    }

    try {
      const rawJSON = fleece.evaluate(this.easJsonRawContents);
      this.easJsonRawObject = rawJSON;
      this.isJson5 = true;
      return rawJSON;
    } catch (originalError: any) {
      const err = new InvalidEasJsonError(`Found invalid character in ${chalk.bold('eas.json')}.`);
      if (originalError.loc) {
        const codeFrame = codeFrameColumns(this.easJsonRawContents, { start: originalError.loc });
        err.message += `\n${codeFrame}`;
      }
      throw err;
    }
  }

  private resetState(): void {
    this.isJson5 = false;
    this.easJson = undefined;
    this.easJsonRawContents = undefined;
    this.easJsonRawObject = undefined;
    this.easJsonPatched = false;
  }
}
