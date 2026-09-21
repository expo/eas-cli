import { errors } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import spawn, { SpawnResult } from '@expo/turtle-spawn';
import os from 'os';
import path from 'path';
import { v4 as uuid } from 'uuid';

import { runFastlane } from '../fastlane';

// Do not log raw fastlane output or spawn errors: they can contain passwords,
// command arguments, and private key attributes from set-key-partition-list.
const IMPORT_CERTIFICATE_DIAGNOSTICS = [
  {
    code: 'PKCS12_MAC_VERIFICATION_FAILED',
    pattern: /SecKeychainItemImport: MAC verification failed during PKCS12 import/i,
    message:
      'macOS could not verify the PKCS#12 MAC. Check the certificate password and PKCS#12 export format; this error does not prove that the password is wrong.',
  },
  {
    code: 'PKCS12_UNKNOWN_FORMAT',
    pattern: /SecKeychainItemImport: Unknown format in import/i,
    message: 'macOS did not recognize the certificate import format.',
  },
  {
    code: 'CERTIFICATE_IMPORT_FAILED',
    pattern:
      /SecKeychainItemImport:(?! MAC verification failed during PKCS12 import| Unknown format in import)/i,
    message: 'macOS reported a certificate import error (SecKeychainItemImport).',
  },
  {
    code: 'PRIVATE_KEY_ACCESS_FAILED',
    pattern: /SecKeychainItemSetAccessWithPassword:/,
    message:
      'macOS could not set access to the imported private key (SecKeychainItemSetAccessWithPassword).',
  },
  {
    code: 'KEYCHAIN_ITEM_LOOKUP_FAILED',
    pattern: /SecItemCopyMatching:/,
    message:
      'macOS could not find an item while configuring private key access (SecItemCopyMatching).',
  },
];

export default class Keychain {
  private readonly keychainPath: string;
  private readonly keychainPassword: string;
  private created = false;
  private destroyed = false;

  constructor() {
    this.keychainPath = path.join(os.tmpdir(), `eas-build-${uuid()}.keychain`);
    this.keychainPassword = uuid();
  }

  get data(): { path: string; password: string } {
    return {
      path: this.keychainPath,
      password: this.keychainPassword,
    };
  }

  public async create({ logger }: { logger: bunyan }): Promise<void> {
    logger.debug(`Creating keychain - ${this.keychainPath}`);
    await runFastlane([
      'run',
      'create_keychain',
      `path:${this.keychainPath}`,
      `password:${this.keychainPassword}`,
      'unlock:true',
      'timeout:360000',
    ]);
    this.created = true;
  }

  public async importCertificate({
    logger,
    certPath,
    certPassword,
  }: {
    logger: bunyan;
    certPath: string;
    certPassword: string;
  }): Promise<void> {
    if (!this.created) {
      throw new Error('You must create a keychain first.');
    }

    logger.debug(`Importing certificate ${certPath} into keychain ${this.keychainPath}`);
    try {
      const result = await runFastlane([
        'run',
        'import_certificate',
        `certificate_path:${certPath}`,
        `certificate_password:${certPassword}`,
        `keychain_path:${this.keychainPath}`,
        `keychain_password:${this.keychainPassword}`,
      ]);
      const output = [result.stdout, result.stderr].join('\n');
      for (const diagnostic of IMPORT_CERTIFICATE_DIAGNOSTICS) {
        if (diagnostic.pattern.test(output)) {
          logger.error({ diagnosticCode: diagnostic.code }, diagnostic.message);
        }
      }
    } catch (error) {
      const processError =
        error instanceof Error
          ? (error as Error &
              Partial<Pick<SpawnResult, 'stdout' | 'stderr'> & NodeJS.ErrnoException>)
          : undefined;
      const output = [processError?.stdout, processError?.stderr]
        .filter(value => typeof value === 'string')
        .join('\n');
      const diagnosticCodes: string[] = [];
      for (const diagnostic of IMPORT_CERTIFICATE_DIAGNOSTICS) {
        if (diagnostic.pattern.test(output)) {
          diagnosticCodes.push(diagnostic.code);
          logger.error({ diagnosticCode: diagnostic.code }, diagnostic.message);
        }
      }

      // Never attach the original error: its message includes passwords.

      if (processError?.code === 'ENOENT' || processError?.code === 'EACCES') {
        throw new errors.SystemError('Fastlane could not be started to import the certificate.', {
          trackingCode: 'IOS_CERTIFICATE_IMPORT_PROCESS_START_FAILED',
        });
      }
      throw new errors.UserError(
        errors.ErrorCode.UNKNOWN_ERROR,
        'Fastlane could not complete certificate import. Check the certificate import diagnostics in the Prepare credentials logs.',
        {
          trackingCode: 'IOS_CERTIFICATE_IMPORT_FAILED',
          metadata: { diagnosticCodes },
        }
      );
    }
  }

  public async ensureCertificateImported({
    teamId,
    fingerprint,
  }: {
    teamId: string;
    fingerprint: string;
  }): Promise<void> {
    const identities = await this.findIdentitiesByTeamId(teamId);
    if (!identities.includes(fingerprint)) {
      throw new Error(
        `Distribution certificate with fingerprint ${fingerprint} hasn't been imported successfully`
      );
    }
  }

  public async destroy({
    logger,
    keychainPath,
  }: {
    logger: bunyan;
    keychainPath?: string;
  }): Promise<void> {
    if (!keychainPath && !this.created) {
      logger.warn("There is nothing to destroy, a keychain hasn't been created yet.");
      return;
    }
    if (this.destroyed) {
      logger.warn('The keychain has been already destroyed');
      return;
    }
    const keychainToDeletePath = keychainPath ?? this.keychainPath;
    logger.info(`Destroying keychain - ${keychainToDeletePath}`);
    try {
      await runFastlane(['run', 'delete_keychain', `keychain_path:${keychainToDeletePath}`]);
      this.destroyed = true;
    } catch (err) {
      logger.error({ err }, 'Failed to delete the keychain\n');
      throw err;
    }
  }

  public async cleanUpKeychains({ logger }: { logger: bunyan }): Promise<void> {
    const { stdout } = await spawn('security', ['list-keychains'], { stdio: 'pipe' });
    const keychainList = (/"(.*)"/g.exec(stdout) ?? ([] as string[])).map(i =>
      i.slice(1, i.length - 1)
    );
    const turtleKeychainList = keychainList.filter(keychain =>
      /eas-build-[\w-]+\.keychain$/.exec(keychain)
    );
    for (const turtleKeychainPath of turtleKeychainList) {
      await this.destroy({ logger, keychainPath: turtleKeychainPath });
    }
  }

  private async findIdentitiesByTeamId(teamId: string): Promise<string> {
    const { output } = await spawn(
      'security',
      ['find-identity', '-v', '-s', `(${teamId})`, this.keychainPath],
      {
        stdio: 'pipe',
      }
    );
    return output.join('');
  }
}
