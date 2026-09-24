import { Platform, SystemError, UserError } from '@expo/eas-build-job';
import { Client } from '@urql/core';
import { graphql } from 'gql.tada';

const BUILD_QUERY = graphql(`
  query SubmissionBuild($buildId: ID!) {
    builds {
      byId(buildId: $buildId) {
        platform
        buildProfile
        app { id }
      }
    }
  }
`);

const IOS_CREDENTIALS_QUERY = graphql(`
  query SubmissionIosCredentials($appId: String!) {
    app {
      byId(appId: $appId) {
        iosAppCredentials {
          appleAppIdentifier { bundleIdentifier }
          appStoreConnectApiKeyForSubmissions { id }
        }
      }
    }
  }
`);

const ASC_KEY_QUERY = graphql(`
  query SubmissionAscKey($id: ID!) {
    appStoreConnectApiKey {
      byId(id: $id) { keyIdentifier issuerIdentifier keyP8 }
    }
  }
`);

const ANDROID_CREDENTIALS_QUERY = graphql(`
  query SubmissionAndroidCredentials($appId: String!, $identifier: String!) {
    app {
      byId(appId: $appId) {
        androidAppCredentials(filter: { applicationIdentifier: $identifier, legacyOnly: false }) {
          googleServiceAccountKeyForSubmissions { keyJson }
        }
      }
    }
  }
`);

export type AscKey = { key_id: string; issuer_id?: string; key: string };

export class SubmissionCredentials {
  constructor(
    private readonly client: Client,
    private readonly appId: string
  ) {}

  async validateBuildAsync(buildId: string, platform: Platform): Promise<string | null> {
    const result = await this.client.query(BUILD_QUERY, { buildId }).toPromise();
    if (result.error) {
      throw new SystemError('Could not load the submission build. Retry the job.', {
        cause: result.error,
      });
    }
    const build = result.data?.builds.byId;
    if (!build || build.app.id !== this.appId || build.platform.toLowerCase() !== platform) {
      throw new UserError(
        'EAS_SUBMISSION_BUILD_MISMATCH',
        'The build does not belong to this project and platform. Select a build from this project.'
      );
    }
    return build.buildProfile ?? null;
  }

  async getAscKeyAsync(identifier: string): Promise<AscKey | null> {
    const result = await this.client
      .query(IOS_CREDENTIALS_QUERY, { appId: this.appId })
      .toPromise();
    if (result.error) {
      throw new SystemError('Could not load iOS submission credentials. Retry the job.', {
        cause: result.error,
      });
    }
    const keyId = result.data?.app.byId.iosAppCredentials.find(
      credentials => credentials.appleAppIdentifier.bundleIdentifier === identifier
    )?.appStoreConnectApiKeyForSubmissions?.id;
    if (!keyId) {
      return null;
    }
    const keyResult = await this.client.query(ASC_KEY_QUERY, { id: keyId }).toPromise();
    if (keyResult.error || !keyResult.data) {
      throw new SystemError('Could not load the App Store Connect API key. Retry the job.', {
        cause: keyResult.error,
      });
    }
    const key = keyResult.data.appStoreConnectApiKey.byId;
    return {
      key_id: key.keyIdentifier,
      ...(key.issuerIdentifier ? { issuer_id: key.issuerIdentifier } : {}),
      key: key.keyP8,
    };
  }

  async getGoogleKeyAsync(identifier: string): Promise<string | null> {
    const result = await this.client
      .query(ANDROID_CREDENTIALS_QUERY, { appId: this.appId, identifier })
      .toPromise();
    if (result.error) {
      throw new SystemError('Could not load Android submission credentials. Retry the job.', {
        cause: result.error,
      });
    }
    return (
      result.data?.app.byId.androidAppCredentials[0]?.googleServiceAccountKeyForSubmissions
        ?.keyJson ?? null
    );
  }
}
