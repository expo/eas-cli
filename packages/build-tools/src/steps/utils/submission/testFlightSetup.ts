import { App, User, UserRole } from '@expo/apple-utils';
import { bunyan } from '@expo/logger';
import { SignJWT, importPKCS8 } from 'jose';
import promiseRetry from 'promise-retry';

import { AscKey } from './credentials';

export async function ensureSubmissionTestFlightSetupAsync(
  key: AscKey,
  appId: string,
  logger: bunyan
): Promise<void> {
  try {
    const jwt = new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: key.key_id })
      .setIssuedAt()
      .setAudience('appstoreconnect-v1')
      .setExpirationTime('20m');
    if (key.issuer_id) {
      jwt.setIssuer(key.issuer_id);
    } else {
      jwt.setSubject('user');
    }
    const context = { token: await jwt.sign(await importPKCS8(key.key, 'ES256')) };
    const app = await App.infoAsync(context, { id: appId });
    if ((await app.getBetaGroupsAsync()).length > 0) {
      return;
    }
    const group = await promiseRetry(
      async retry => {
        try {
          return await app.createBetaGroupAsync({
            name: 'Team (Expo)',
            isInternalGroup: true,
            hasAccessToAllBuilds: true,
          });
        } catch (error) {
          const appleError = error as { data?: { errors?: { code?: string }[] } };
          if (
            appleError.data?.errors?.some(item => item.code === 'ENTITY_ERROR.RELATIONSHIP.INVALID')
          ) {
            return retry(error);
          }
          throw error;
        }
      },
      { retries: 14, minTimeout: 10_000, maxTimeout: 10_000 }
    );
    const users = await User.getAsync(context);
    const admins = users.filter(
      user => user.attributes.roles?.includes(UserRole.ADMIN) && user.attributes.email
    );
    if (admins.length > 0) {
      const result = await group.createBulkBetaTesterAssignmentsAsync(
        admins.map(user => ({
          email: user.attributes.email!,
          firstName: user.attributes.firstName ?? '',
          lastName: user.attributes.lastName ?? '',
        }))
      );
      if (result.attributes.betaTesters.some(tester => tester.assignmentResult !== 'ASSIGNED')) {
        logger.warn(
          'Some administrators could not be added to TestFlight. Check the Team (Expo) group in App Store Connect.'
        );
      }
    }
  } catch {
    logger.warn(
      'Could not set up the internal TestFlight group. Submission will continue. Check the groups in App Store Connect.'
    );
  }
}
