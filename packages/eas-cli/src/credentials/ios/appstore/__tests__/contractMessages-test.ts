const expiredMembership = {
  subject: 'Developer Program Membership Expired',
  message:
    "Your membership has expired, and your apps have been removed from the App Store until you renew your membership. To renew, a user with the Account Holder role must <a href='http://developer.apple.com/membercenter/index.action' target='_blank'>sign in</a> and renew the membership on the Apple Developer website. <a href='https://developer.apple.com/support/renewal/' target='_blank'>Learn More</a>.",
};
const paymentReturned = {
  subject: 'Payment Returned',
  message:
    "Your payment was returned by your bank. The reason your payment was returned is:<br/><br/>Your bank account number is formatted incorrectly.<br/><br/>You can review your banking information and make any necessary changes in  <a href='/agreements/#' target='_self'>Agreements, Tax, and Banking</a> for: <br/>CHASE BANK - ****1234 <br/>Bank Payment Reference Number: 123456789",
};
const licenseAgreementUpdated = {
  subject: 'Apple Developer Program License Agreement Updated',
  message:
    'The updated Apple Developer Program License Agreement needs to be reviewed. In order to update your existing apps and submit new apps to the App Store, the Account Holder must review and accept the updated agreement by signing in to their <a href="https://developer.apple.com/account" target="_blank">account</a> on the Apple Developer website.',
};
const paidLicenseAgreementUpdated = {
  subject: '',
  message:
    '<b>Review the updated Paid Applications Schedule.</b><br />In order to update your existing apps, create new in-app purchases, and submit new apps to the App Store, the user with the Legal role (Account Holder) must review and accept the Paid Applications Schedule (Schedule 2 to the Apple Developer Program License Agreement) in the Agreements, Tax, and Banking module.<br /><br /> To accept this agreement, they must have already accepted the latest version of the Apple Developer Program License Agreement in their <a href="http://developer.apple.com/membercenter/index.action">account on the developer website<a/>.<br />',
};

import { formatContractMessage } from '../contractMessages';

describe(formatContractMessage, () => {
  it(`formats expired message`, () => {
    expect(formatContractMessage(expiredMembership as any))
      .toBe(`› Developer Program Membership Expired  
Your membership has expired, and your apps have been removed from the App Store
until you renew your membership. To renew, a user with the Account Holder role
must sign in (http://developer.apple.com/membercenter/index.action) and renew
the membership on the Apple Developer website. Learn More
(https://developer.apple.com/support/renewal/).`);
  });
  it(`formats payment message`, () => {
    expect(formatContractMessage(paymentReturned as any)).toBe(`› Payment Returned  
Your payment was returned by your bank. The reason your payment was returned
is:   
Your bank account number is formatted incorrectly.   
You can review your banking information and make any necessary changes in
Agreements, Tax, and Banking (https://appstoreconnect.apple.com/agreements/#)
for:  
CHASE BANK - \\*\\*\\*\\*1234  
Bank Payment Reference Number: 123456789`);
  });
  it(`formats license message`, () => {
    expect(formatContractMessage(licenseAgreementUpdated as any))
      .toBe(`› Apple Developer Program License Agreement Updated  
The updated Apple Developer Program License Agreement needs to be reviewed. In
order to update your existing apps and submit new apps to the App Store, the
Account Holder must review and accept the updated agreement by signing in to
their account (https://developer.apple.com/account) on the Apple Developer
website.`);
  });
  it(`formats paid license message`, () => {
    expect(formatContractMessage(paidLicenseAgreementUpdated as any))
      .toBe(`› Review the updated Paid Applications Schedule.  
In order to update your existing apps, create new in-app purchases, and submit
new apps to the App Store, the user with the Legal role (Account Holder) must
review and accept the Paid Applications Schedule (Schedule 2 to the Apple
Developer Program License Agreement) in the Agreements, Tax, and Banking
module.   
To accept this agreement, they must have already accepted the latest version of
the Apple Developer Program License Agreement in their account on the developer
website (http://developer.apple.com/membercenter/index.action).`);
  });
});
