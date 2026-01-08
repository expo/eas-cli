export const EasBuildConfigureVersionGradleTemplate = `// Build integration with EAS

import java.nio.file.Paths

def versionCodeVal = null
def versionNameVal = null
<% if (VERSION_CODE) { %>
    versionCodeVal = "<%- VERSION_CODE %>"
<% } %>
<% if (VERSION_NAME) { %>
    versionNameVal = "<%- VERSION_NAME %>"
<% } %>

android {
  defaultConfig {
    if (versionCodeVal) {
      versionCode = Integer.parseInt(versionCodeVal)
    }
    if (versionNameVal) {
      versionName = versionNameVal
    }
  }
  applicationVariants.all { variant ->
    variant.outputs.each { output ->
      if (versionCodeVal) {
        output.versionCodeOverride = Integer.parseInt(versionCodeVal)
      }
      if (versionNameVal) {
        output.versionNameOverride = versionNameVal
      }
    }
  }
}
`;
