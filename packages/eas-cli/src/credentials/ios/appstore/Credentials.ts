import dateformat from 'dateformat';

import {
  DistributionCertificate,
  DistributionCertificateStoreInfo,
  PushKey,
  PushKeyStoreInfo,
} from './Credentials.types.js';

export function formatDistributionCertificate({
  name,
  id,
  status,
  expires,
  created,
  ownerName,
}: DistributionCertificateStoreInfo): string {
  const expiresDate = formatTimestamp(expires);
  const createdDate = formatTimestamp(created);
  return `${name} (${status}) - ID: ${id} - expires: ${expiresDate} (created: ${createdDate}) - owner: ${ownerName}`;
}

export function isDistributionCertificate(val: {
  [key: string]: any;
}): val is DistributionCertificate {
  return (
    val.certP12 &&
    typeof val.certP12 === 'string' &&
    val.certPassword &&
    typeof val.certPassword === 'string' &&
    val.teamId &&
    typeof val.teamId === 'string'
  );
}

export function formatPushKey({ id, name }: PushKeyStoreInfo): string {
  return `${name} - ID: ${id}`;
}

export function isPushKey(obj: { [key: string]: any }): obj is PushKey {
  return (
    obj.apnsKeyP8 &&
    typeof obj.apnsKeyP8 === 'string' &&
    obj.apnsKeyId &&
    typeof obj.apnsKeyId === 'string' &&
    obj.teamId &&
    typeof obj.teamId === 'string'
  );
}

function formatTimestamp(timestamp: number): string {
  return dateformat(new Date(timestamp * 1000));
}
