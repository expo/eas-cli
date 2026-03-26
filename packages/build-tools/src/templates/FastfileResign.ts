export const FastfileResignTemplate = `lane :do_resign do
  resign(
    ipa: "<%- IPA_PATH %>",
    signing_identity: "<%- SIGNING_IDENTITY %>",
    provisioning_profile: {<% _.forEach(PROFILES, function(profile) { %>
      "<%- profile.BUNDLE_ID %>" => "<%- profile.PATH %>",<% }); %>
    },
    keychain_path: "<%- KEYCHAIN_PATH %>"
  )
end
`;
