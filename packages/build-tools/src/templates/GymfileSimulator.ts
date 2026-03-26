export const GymfileSimulatorTemplate = `suppress_xcode_output(true)
clean(<%- CLEAN %>)

scheme("<%- SCHEME %>")
<% if (SCHEME_BUILD_CONFIGURATION) { %>
configuration("<%- SCHEME_BUILD_CONFIGURATION %>")
<% } %>

derived_data_path("<%- DERIVED_DATA_PATH %>")
skip_package_ipa(true)
skip_archive(true)
destination("<%- SCHEME_SIMULATOR_DESTINATION %>")

disable_xcpretty(true)
buildlog_path("<%- LOGS_DIRECTORY %>")
`;
