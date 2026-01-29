import { Ios } from '@expo/eas-build-job';
import forge from 'node-forge';

export function getFingerprint({ dataBase64, password }: Ios.DistributionCertificate): string {
  const certData = getCertData(dataBase64, password);
  const certAsn1 = forge.pki.certificateToAsn1(certData);
  const certDer = forge.asn1.toDer(certAsn1).getBytes();
  const fingerprint = forge.md.sha1.create().update(certDer).digest().toHex().toUpperCase();
  return fingerprint;
}

export function getCommonName({ dataBase64, password }: Ios.DistributionCertificate): string {
  const certData = getCertData(dataBase64, password);
  const { attributes } = certData.subject;
  const commonNameAttribute = attributes.find(
    ({ name }: { name?: string }) => name === 'commonName'
  );
  return Buffer.from(commonNameAttribute.value, 'ascii').toString();
}

function getCertData(certificateBase64: string, password: string): any {
  const p12Der = forge.util.decode64(certificateBase64);
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    if (password) {
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    } else {
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1);
    }
  } catch (_error: any) {
    const error: Error = _error;
    if (/Invalid password/.exec(error.message)) {
      throw new Error('Provided password for the distribution certificate is probably invalid');
    } else {
      throw error;
    }
  }

  const certBagType = forge.pki.oids.certBag;
  const certData = p12.getBags({ bagType: certBagType })?.[certBagType]?.[0]?.cert;
  if (!certData) {
    throw new Error("getCertData: couldn't find cert bag");
  }
  return certData;
}
