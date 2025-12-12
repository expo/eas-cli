# frozen_string_literal: true

lib = File.expand_path('lib', __dir__)
$LOAD_PATH.unshift(lib) unless $LOAD_PATH.include?(lib)
require 'expo_cocoapods_proxy/gem_version'

Gem::Specification.new do |spec|
  spec.name          = 'expo-cocoapods-proxy'
  spec.version       = ExpoCocoaPodsProxy::VERSION
  spec.authors       = ['Mike Hampton']
  spec.email         = ['mike@expo.dev']

  spec.summary       = 'A Cocoapods plugin for routing requests through a proxy cache server.'
  spec.homepage      = 'https://expo.dev'
  spec.license       = 'MIT'

  # Prevent pushing this gem to RubyGems.org. To allow pushes either set the 'allowed_push_host'
  # to allow pushing to a single host or delete this section to allow pushing to any host.
  if spec.respond_to?(:metadata)
    spec.metadata['allowed_push_host'] = 'TODO: Set to \'http://mygemserver.com\''

    spec.metadata['homepage_uri'] = spec.homepage
    spec.metadata['source_code_uri'] = 'https://github.com/expo/eas-cli'
  else
    raise 'RubyGems 2.0 or newer is required to protect against ' \
          'public gem pushes.'
  end

  spec.required_ruby_version = '>= 2.7', '< 4'
  spec.files = Dir['lib/**/*.rb']
  spec.bindir = 'exe'
  spec.executables = spec.files.grep(%r{^exe/}) { |f| File.basename(f) }
  spec.require_paths = ['lib']

  spec.add_development_dependency 'bundler', '~> 1.17'
  spec.add_development_dependency 'rake', '~> 10.0'
  spec.add_development_dependency 'rspec', '~> 3.0'
end
