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
}

// AGP 9's new DSL removes the applicationVariants API, we set the version on each output through the androidComponents API instead.
def easAndroidExtension = project.extensions.getByName('android')
if (easAndroidExtension.hasProperty('applicationVariants')) {
  easAndroidExtension.applicationVariants.all { variant ->
    variant.outputs.each { output ->
      if (versionCodeVal) {
        output.versionCodeOverride = Integer.parseInt(versionCodeVal)
      }
      if (versionNameVal) {
        output.versionNameOverride = versionNameVal
      }
    }
  }
} else {
  def easAndroidComponents = project.extensions.getByName('androidComponents')
  easAndroidComponents.onVariants(easAndroidComponents.selector().all()) { variant ->
    variant.outputs.each { output ->
      if (versionCodeVal) {
        output.versionCode.set(Integer.parseInt(versionCodeVal))
      }
      if (versionNameVal) {
        output.versionName.set(versionNameVal)
      }
    }
  }
}
`;
