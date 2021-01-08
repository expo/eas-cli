import gql from 'graphql-tag';

import { Fragment } from '../../fragment';

export const AppleDeviceRegistrationRequestFragment: Fragment = {
  name: 'appleDeviceRegistrationRequest',
  definition: gql`
    fragment appleDeviceRegistrationRequest on AppleDeviceRegistrationRequest {
      id
    }
  `,
};
