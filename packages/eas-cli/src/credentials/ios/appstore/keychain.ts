import keychain from 'keychain';

const KEYCHAIN_TYPE = 'internet';
const NO_PASSWORD_REGEX = /Could not find password/;

// When enabled, the password will not only be skipped but also deleted.
// This makes it easier to completely opt-out of Keychain functionality.
export const EXPO_NO_KEYCHAIN = process.env['EXPO_NO_KEYCHAIN'];

interface Credentials {
  serviceName: string;
  username: string;
  password: string;
}

export async function deletePasswordAsync({
  username,
  serviceName,
}: Pick<Credentials, 'username' | 'serviceName'>): Promise<void> {
  return await new Promise((resolve, reject) => {
    keychain.deletePassword(
      { account: username, service: serviceName, type: KEYCHAIN_TYPE },
      (error: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      }
    );
  });
}

export async function getPasswordAsync({
  username,
  serviceName,
}: Pick<Credentials, 'serviceName' | 'username'>): Promise<string | null> {
  return await new Promise((resolve, reject) => {
    keychain.getPassword(
      { account: username, service: serviceName, type: KEYCHAIN_TYPE },
      (error: Error, password: string) => {
        if (error) {
          if (error.message.match(NO_PASSWORD_REGEX)) {
            return resolve(null);
          }
          reject(error);
        } else {
          resolve(password);
        }
      }
    );
  });
}

export async function setPasswordAsync({
  serviceName,
  username,
  password,
}: Credentials): Promise<void> {
  return await new Promise((resolve, reject) => {
    keychain.setPassword(
      { account: username, service: serviceName, password, type: KEYCHAIN_TYPE },
      (error: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      }
    );
  });
}
