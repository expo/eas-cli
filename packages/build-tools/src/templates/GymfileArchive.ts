export const GymfileArchiveTemplate = `suppress_xcode_output(true)
clean(<%- CLEAN %>)

scheme("<%- SCHEME %>")
<% if (SCHEME_BUILD_CONFIGURATION) { %>
configuration("<%- SCHEME_BUILD_CONFIGURATION %>")
<% } %>

export_options({
  method: "<%- EXPORT_METHOD %>",
  provisioningProfiles: {<% _.forEach(PROFILES, function(profile) { %>
    "<%- profile.BUNDLE_ID %>" => "<%- profile.UUID %>",<% }); %>
  }<% if (ICLOUD_CONTAINER_ENVIRONMENT) { %>,
  iCloudContainerEnvironment: "<%- ICLOUD_CONTAINER_ENVIRONMENT %>"
<% } %>
})

export_xcargs "OTHER_CODE_SIGN_FLAGS=\\"--keychain <%- KEYCHAIN_PATH %>\\""

disable_xcpretty(true)
buildlog_path("<%- LOGS_DIRECTORY %>")

output_directory("<%- OUTPUT_DIRECTORY %>")
`;
