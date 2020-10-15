const generateDeviceRegistrationURL = jest.fn().mockImplementation(() => {
  return 'http://expo.io/register-device/4a96ee13-411e-4275-bbf9-2b5c024c761a';
});

export { generateDeviceRegistrationURL };
