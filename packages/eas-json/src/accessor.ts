import { codeFrameColumns } from '@babel/code-frame';
import assert from 'assert';
import fs from 'fs-extra';
import * as fleece from 'golden-fleece';
import path from 'path';

import { InvalidEasJsonError, MissingEasJsonError } from './errors';
import { EasJsonSchema } from './schema';
import { EasJson } from './types';

export class EasJsonAccessor {
  private easJsonPath: string;

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

    const rawJSON = await this.readRawJSONAsync();
    const { value, error } = EasJsonSchema.validate(rawJSON, {
      allowUnknown: false,
      abortEarly: false,
      convert: true,
      noDefaults: true,
    });
    if (error) {
      throw new InvalidEasJsonError(`eas.json is not valid [${error.toString()}]`);
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
      'call readAsync/readRawJSONAsync first'
    );

    this.easJsonRawObject = fn(this.easJsonRawObject);
    this.easJsonRawContents = fleece.patch(this.easJsonRawContents, this.easJsonRawObject);
    this.easJsonPatched = true;
  }

  public async readRawJSONAsync(): Promise<any> {
    if (!(await fs.pathExists(this.easJsonPath))) {
      throw new MissingEasJsonError(
        `eas.json could not be found at ${this.easJsonPath}. Learn more at https://expo.fyi/eas-json`
      );
    }

    this.easJsonRawContents = await fs.readFile(this.easJsonPath, 'utf-8');

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
      return rawJSON;
    } catch (originalError: any) {
      const err = new Error('Found invalid JSON in eas.json.');
      if (originalError.loc) {
        const codeFrame = codeFrameColumns(this.easJsonRawContents, { start: originalError.loc });
        err.message += `\n${codeFrame}`;
      }
      throw err;
    }
  }

  private resetState(): void {
    this.easJson = undefined;
    this.easJsonRawContents = undefined;
    this.easJsonRawObject = undefined;
    this.easJsonPatched = false;
  }
}
