import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { spawnSync, spawn } from 'child_process';

import Log from '../../../log';
import { SubmissionContext } from '../../context';
import {
    AscApiKeySource,
    AscApiKeySourceType,
    getAscApiKeyResultAsync,
} from '../../ios/AscApiKeySource';
import { AppStoreConnectApiKeyQuery } from '../../../graphql/queries/AppStoreConnectApiKeyQuery';

export async function submitLocalIosAsync(ctx: SubmissionContext<Platform.IOS>): Promise<void> {
    // local submit currently only supports a local path to an .ipa
    const { path: ipaPath } = ctx.archiveFlags as { path?: string };
    if (!ipaPath) {
        throw new Error('--local currently requires --path to a local .ipa file');
    }
    if (!(await fs.pathExists(ipaPath))) {
        throw new Error(`File ${ipaPath} does not exist`);
    }

    // Resolve ASC Api Key source (reuse logic from IosSubmitCommand.resolveAscApiKeySource)
    const { ascApiKeyPath, ascApiKeyIssuerId, ascApiKeyId } = ctx.profile as any;
    let ascSource: AscApiKeySource;
    if (ascApiKeyPath && ascApiKeyIssuerId && ascApiKeyId) {
        ascSource = {
            sourceType: AscApiKeySourceType.path,
            path: {
                keyP8Path: ascApiKeyPath,
                keyId: ascApiKeyId,
                issuerId: ascApiKeyIssuerId,
            },
        };
    } else if (ascApiKeyPath || ascApiKeyIssuerId || ascApiKeyId) {
        const message = `ascApiKeyPath, ascApiKeyIssuerId and ascApiKeyId must all be defined in eas.json`;
        if (ctx.nonInteractive) {
            throw new Error(message);
        }
        Log.warn(message);
        ascSource = { sourceType: AscApiKeySourceType.prompt };
    } else {
        ascSource = { sourceType: AscApiKeySourceType.credentialsService };
    }

    // Obtain key material
    let keyP8: string;
    let keyId: string;
    let issuerId: string;

    const ascResult = await getAscApiKeyResultAsync(ctx, ascSource);
    if ('ascApiKeyId' in ascResult.result) {
        const key = await AppStoreConnectApiKeyQuery.getByIdAsync(ctx.graphqlClient, ascResult.result.ascApiKeyId);
        issuerId = key.issuerIdentifier;
        keyId = key.keyIdentifier;
        keyP8 = key.keyP8;
    } else {
        const r = ascResult.result as any;
        keyP8 = r.keyP8;
        keyId = r.keyId;
        issuerId = r.issuerId;
    }

    // write temporary api key json for fastlane/transport
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-asc-'));
    const tmpPath = path.join(tmpDir, 'asc.json');
    const json = {
        key_id: keyId,
        issuer_id: issuerId,
        key: keyP8,
    };
    await fs.writeFile(tmpPath, JSON.stringify(json));

    // Ensure fastlane is available (we use fastlane pilot upload for ASC key-based upload)
    const which = spawnSync('fastlane', ['--version'], { stdio: 'ignore' });
    if (which.status !== 0) {
        await fs.remove(tmpPath);
        await fs.remove(tmpDir);
        throw new Error(
            'fastlane is not installed or not available in PATH. Install fastlane to perform local ASC key uploads.'
        );
    }

    const args: string[] = ['pilot', 'upload', '-i', ipaPath, '--api_key_path', tmpPath];
    if (ctx.whatToTest) {
        args.push('--changelog', ctx.whatToTest);
    }

    Log.log(`Running: fastlane ${args.join(' ')}`);
    await new Promise<void>((resolve, reject) => {
        const child = spawn('fastlane', args, { stdio: 'inherit', env: process.env });
        child.on('error', err => reject(err));
        child.on('close', code => {
            fs.remove(tmpPath).catch(() => { });
            fs.remove(tmpDir).catch(() => { });
            if (code === 0) {
                Log.log('Uploaded to App Store Connect via fastlane');
                resolve();
            } else {
                reject(new Error(`fastlane exited with code ${code}`));
            }
        });
    });
}

export default submitLocalIosAsync;
