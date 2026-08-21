# frozen_string_literal: true

require 'tmpdir'
require 'digest'
require 'json'
require 'open3'
require 'pathname'
require 'rbconfig'
require 'socket'
require 'uri'

class LocalCdnServer
  attr_reader :requests

  def initialize(root, responses = {})
    @root = Pathname.new(root)
    @responses = responses
    @server = TCPServer.new('127.0.0.1', 0)
    @requests = []
    @mutex = Mutex.new
  end

  def start
    @thread = Thread.new do
      loop do
        socket = @server.accept
        Thread.new(socket) { |client| handle(client) }
      rescue IOError
        break
      end
    end
  end

  def stop
    @server.close unless @server.closed?
    @thread&.join
  end

  def url
    "http://127.0.0.1:#{@server.addr[1]}"
  end

  private

  def response_for(path)
    @responses[path]
  end

  def handle(client)
    request = read_request(client)
    return if request.nil?

    response = response_for_request(request[:path])
    write_custom_response(client, response)
    record_request(request[:method], request[:path], response[:status])
  ensure
    client&.close
  end

  def response_for_request(path)
    response_for(path) || file_response(path) || { status: 404, message: 'Not Found', body: 'Not Found' }
  end

  def read_request(client)
    request_line = client.gets
    return if request_line.nil?

    method, raw_path = request_line.split
    while (line = client.gets)
      break if line == "\r\n"
    end

    { method: method, path: URI.decode_www_form_component(raw_path.split('?').first) }
  end

  def file_for_request(path)
    (@root + path.sub(%r{\A/}, '')).expand_path
  end

  def file_response(path)
    file = file_for_request(path)
    return unless served_file?(file)

    { status: 200, message: 'OK', body: file.binread }
  end

  def served_file?(file)
    file.file? && file.to_s.start_with?(@root.expand_path.to_s)
  end

  def write_custom_response(client, response)
    write_response(client, response[:status], response[:message], response[:body])
  end

  def write_response(client, status, message, body)
    client.write("HTTP/1.1 #{status} #{message}\r\n")
    client.write("Content-Length: #{body.bytesize}\r\n")
    client.write("Connection: close\r\n")
    client.write("\r\n")
    client.write(body)
  end

  def record_request(method, path, status)
    @mutex.synchronize { @requests << { method: method, path: path, status: status } }
  end
end

RSpec.describe ExpoCocoaPodsProxy do
  around do |example|
    original_cache_url = ENV.fetch('EAS_BUILD_COCOAPODS_CACHE_URL', nil)
    original_repos_dir = Pod::Config.instance.repos_dir

    example.run
  ensure
    ENV['EAS_BUILD_COCOAPODS_CACHE_URL'] = original_cache_url
    Pod::Config.instance.repos_dir = original_repos_dir
  end

  describe ExpoCocoaPodsProxy::SourceProvider do
    it 'registers the plugin as a default CocoaPods plugin' do
      expect(Pod::Installer::DEFAULT_PLUGINS).to include(ExpoCocoaPodsProxy::NAME)
    end

    it 'does not add a source when EAS_BUILD_COCOAPODS_CACHE_URL is not set' do
      ENV.delete('EAS_BUILD_COCOAPODS_CACHE_URL')
      context = instance_double(Pod::Installer::SourceProviderHooksContext)

      expect(context).not_to receive(:add_source)

      described_class.register_source(context)
    end

    it 'does not add a source when EAS_BUILD_COCOAPODS_CACHE_URL is empty' do
      ENV['EAS_BUILD_COCOAPODS_CACHE_URL'] = ''
      context = instance_double(Pod::Installer::SourceProviderHooksContext)

      expect(context).not_to receive(:add_source)

      described_class.register_source(context)
    end

    it 'adds the existing trunk repo as a CDN source for the proxied CocoaPods CDN' do
      Dir.mktmpdir do |repos_dir|
        ENV['EAS_BUILD_COCOAPODS_CACHE_URL'] = 'http://localhost:9001'
        Pod::Config.instance.repos_dir = Pathname.new(repos_dir)
        context = instance_double(Pod::Installer::SourceProviderHooksContext)
        proxied_source = instance_double(ExpoCocoaPodsProxy::FallbackableCDNSource)
        fallback_source = instance_double(Pod::TrunkSource)
        repo_dir = Pathname.new(repos_dir) + Pod::TrunkSource::TRUNK_REPO_NAME

        allow(ExpoCocoaPodsProxy::FallbackableCDNSource).to receive(:new).with(repo_dir).and_return(proxied_source)
        allow(Pod::TrunkSource).to receive(:new).with(repo_dir).and_return(fallback_source)
        expect(context).to receive(:add_source).with(proxied_source).ordered
        expect(context).to receive(:add_source).with(fallback_source).ordered

        described_class.register_source(context)

        expect(File.read(repo_dir.join('.url'))).to eq('http://localhost:9001/cdn.cocoapods.org/')
      end
    end

    it 'normalizes trailing slashes in the proxy URL' do
      ENV['EAS_BUILD_COCOAPODS_CACHE_URL'] = 'http://localhost:9001/'

      expect(described_class.proxied_cocoapods_cdn_url).to eq(
        'http://localhost:9001/cdn.cocoapods.org/'
      )
    end

    it 'prevents default trunk insertion when CocoaPods has no Podfile sources' do
      Dir.mktmpdir do |root_dir|
        root_path = Pathname.new(root_dir)
        podfile_path = root_path.join('Podfile')
        podfile_path.write(<<~PODFILE)
          target 'App' do
            pod 'Sentry'
          end
        PODFILE
        podfile = Pod::Podfile.from_file(podfile_path)
        sandbox = Pod::Sandbox.new(root_path.join('Pods'))
        proxy_source = instance_double(Pod::CDNSource, name: 'trunk', url: 'proxy')
        fallback_source = instance_double(Pod::TrunkSource, name: 'trunk', url: 'https://cdn.cocoapods.org/')
        plugin_sources = [proxy_source, fallback_source]
        analyzer = Pod::Installer::Analyzer.new(sandbox, podfile, nil, plugin_sources, true)

        allow(analyzer.sources_manager).to receive(:add_source)

        expect(analyzer.send(:sources)).to eq(plugin_sources)
      end
    end
  end

  describe 'pod install integration' do
    let(:pod_name) { 'LocalTestPod' }
    let(:pod_version) { '1.0.0' }
    let(:pod_fragment_path) do
      digest = Digest::MD5.hexdigest(pod_name)
      [digest[0], digest[1], digest[2]]
    end
    let(:versions_path) { "all_pods_versions_#{pod_fragment_path.join('_')}.txt" }
    let(:podspec_path) do
      "Specs/#{pod_fragment_path.join('/')}/#{pod_name}/#{pod_version}/#{pod_name}.podspec.json"
    end

    it 'uses the proxied CocoaPods CDN before trunk during pod install' do
      Dir.mktmpdir do |root_dir|
        root = Pathname.new(root_dir)
        source_url = create_local_pod_source(root, pod_name, pod_version)
        write_cdn(root.join('proxy', 'cdn.cocoapods.org'), pod_name, pod_version, source_url)
        write_cdn(root.join('trunk'), pod_name, pod_version, source_url)

        proxy_server = start_cdn_server(root.join('proxy'))
        trunk_server = start_cdn_server(root.join('trunk'))
        result = run_pod_install(root, proxy_server.url, "#{trunk_server.url}/")

        expect_pod_install_to_succeed(result)
        expect(request_paths(proxy_server)).to include(
          "/cdn.cocoapods.org/#{versions_path}",
          "/cdn.cocoapods.org/#{podspec_path}"
        )
        expect(trunk_server.requests).to be_empty
      end
    end

    it 'falls back to trunk when the proxied CocoaPods CDN misses during pod install' do
      Dir.mktmpdir do |root_dir|
        root = Pathname.new(root_dir)
        source_url = create_local_pod_source(root, pod_name, pod_version)
        write_cocoapods_version_file(root.join('proxy', 'cdn.cocoapods.org'))
        write_cdn(root.join('trunk'), pod_name, pod_version, source_url)

        proxy_server = start_cdn_server(root.join('proxy'))
        trunk_server = start_cdn_server(root.join('trunk'))
        result = run_pod_install(root, proxy_server.url, "#{trunk_server.url}/")

        expect_pod_install_to_succeed(result)
        expect(proxy_server.requests).to include(
          hash_including(path: "/cdn.cocoapods.org/#{versions_path}", status: 404)
        )
        expect(request_paths(trunk_server)).to include(
          "/#{versions_path}",
          "/#{podspec_path}"
        )
      end
    end

    it 'falls back to trunk when the proxied CocoaPods CDN is rate limited during pod install' do
      Dir.mktmpdir do |root_dir|
        root = Pathname.new(root_dir)
        source_url = create_local_pod_source(root, pod_name, pod_version)
        write_cocoapods_version_file(root.join('proxy', 'cdn.cocoapods.org'))
        write_cdn(root.join('trunk'), pod_name, pod_version, source_url)

        proxied_versions_path = "/cdn.cocoapods.org/#{versions_path}"
        proxy_server = start_cdn_server(
          root.join('proxy'),
          proxied_versions_path => { status: 429, message: 'Too Many Requests', body: 'Too Many Requests' }
        )
        trunk_server = start_cdn_server(root.join('trunk'))
        result = run_pod_install(root, proxy_server.url, "#{trunk_server.url}/")

        expect_pod_install_to_succeed(result)
        expect(proxy_server.requests).to include(
          hash_including(path: proxied_versions_path, status: 429)
        )
        expect(request_paths(trunk_server)).to include(
          "/#{versions_path}",
          "/#{podspec_path}"
        )
      end
    end
  end

  describe 'With EAS_BUILD_COCOAPODS_CACHE_URL not set' do
    it 'does not rewrite GitHub repos' do
      path = Pathname.new('some/fake/path')
      url = 'https://github.com/expo/expo.git'
      opts = { branch: 'main' }
      downloader = Pod::Downloader::Git.new(path, url, opts)

      expect(downloader).to receive(:orig_download!) {}

      downloader.download!
    end

    it 'does not proxy Http pods' do
      path = Pathname.new('some/fake/path')
      url = 'https://github.com/expo/test-repo/archive/main.tar.gz'
      opts = {}
      downloader = Pod::Downloader::Http.new(path, url, opts)

      expect(downloader).to receive(:orig_download_file) {}

      downloader.download_file(path.to_s)
      expect(downloader).to have_attributes(url: url)
    end
  end

  describe 'With EAS_BUILD_COCOAPODS_CACHE_URL set' do
    before(:context) do
      ENV['EAS_BUILD_COCOAPODS_CACHE_URL'] = 'http://localhost:9001'
    end

    it 'rewrites github urls when submodules is not set' do
      path = Pathname.new('some/fake/path')
      url = 'https://github.com/expo/test-repo.git'
      opts = { branch: 'main' }
      downloader = Pod::Downloader::Git.new(path, url, opts)

      expect(downloader).to receive(:download_from_github!) {}

      downloader.download!
    end

    it 'does not fetch tarballs when submodules is set' do
      path = Pathname.new('some/fake/path')
      url = 'https://github.com/expo/test-repo.git'
      opts = { branch: 'main', submodules: true }
      downloader = Pod::Downloader::Git.new(path, url, opts)

      expect(downloader).to receive(:orig_download!) {}

      downloader.download!
    end

    it 'does not create tarballs for non-github repos' do
      path = Pathname.new('some/fake/path')
      url = 'https://not-github.com/expo/test-repo.git'
      opts = { branch: 'main' }
      downloader = Pod::Downloader::Git.new(path, url, opts)

      expect(downloader).to receive(:orig_download!) {}

      downloader.download!
    end

    it 'modifies github repos to be tarballs' do
      path = Pathname.new('some/fake/path')
      url = 'https://github.com/expo/test-repo.git'
      opts = { branch: 'main' }
      expected_url = 'https://github.com/expo/test-repo/archive/main.tar.gz'
      downloader = Pod::Downloader::Git.new(path, url, opts)

      allow(Pod::Downloader::Http).to receive(:initialize).with(path, expected_url, anything)
      expect_any_instance_of(Pod::Downloader::Http).to receive(:download) {}

      downloader.download_from_github!
    end

    it 'modifies github repos to be tarballs from the api when branch not set' do
      path = Pathname.new('some/fake/path')
      url = 'https://github.com/expo/test-repo.git'
      opts = {}
      expected_url = 'https://api.github.com/repos/expo/test-repo/tarball'
      downloader = Pod::Downloader::Git.new(path, url, opts)

      allow(Pod::Downloader::Http).to receive(:initialize).with(path, expected_url, anything)
      expect_any_instance_of(Pod::Downloader::Http).to receive(:download) {}

      downloader.download_from_github!
    end

    it 'does not proxy when netrc is present' do
      path = Pathname.new('some/fake/path')
      url = 'https://github.com/expo/test-repo/archive/main.tar.gz'
      opts = {}
      downloader = Pod::Downloader::Http.new(path, url, opts)

      expect(File).to receive(:exist?).with("#{Dir.home}/.netrc") { true }
      expect(downloader).to receive(:orig_download_file) {}

      downloader.download_file(path.to_s)
    end

    it 'does not proxy when NETRC env var is set' do
      path = Pathname.new('some/fake/path')
      url = 'https://github.com/expo/test-repo/archive/main.tar.gz'
      opts = {}
      downloader = Pod::Downloader::Http.new(path, url, opts)

      allow(ENV).to receive(:[]).and_call_original
      expect(ENV).to receive(:[]).with('NETRC').and_return('psyduck')
      expect(downloader).to receive(:orig_download_file) {}

      downloader.download_file(path.to_s)
      expect(downloader).to have_attributes(url: url)
    end

    it 'falls back to original download when proxy fails' do
      path = Pathname.new('some/fake/path')
      url = 'https://github.com/expo/test-repo/archive/main.tar.gz'
      opts = {}
      downloader = Pod::Downloader::Http.new(path, url, opts)

      expect(downloader).to receive(:orig_download_file).once.and_raise
      expect(downloader).to receive(:orig_download_file).once {}

      downloader.download_file(path.to_s)
      expect(downloader).to have_attributes(url: url)
    end

    it 'fetches via proxy when url matches an allowlist regex' do
      path = Pathname.new('some/fake/path')
      url = 'https://github.com/expo/test-repo/archive/main.tar.gz'
      opts = {}
      downloader = Pod::Downloader::Http.new(path, url, opts)

      expect(downloader).to receive(:download_file_via_proxy).once {}

      downloader.download_file(path.to_s)
    end

    it 'does not proxy when url doesn\'t match an allowlist regex' do
      path = Pathname.new('some/fake/path')
      url = 'https://not-github.com/expo/test-repo/archive/main.tar.gz'
      opts = {}
      downloader = Pod::Downloader::Http.new(path, url, opts)

      expect(downloader).to receive(:orig_download_file).once {}

      downloader.download_file(path.to_s)
    end

    it 'does not proxy when curlrc is present in home directory' do
      path = Pathname.new('some/fake/path')
      url = 'https://github.com/expo/test-repo/archive/main.tar.gz'
      opts = {}
      downloader = Pod::Downloader::Http.new(path, url, opts)

      allow(File).to receive(:exist?).and_call_original
      expect(File).to receive(:exist?).at_least(1).times.with("#{Dir.home}/.curlrc") { true }

      expect(downloader).to receive(:orig_download_file).once {}
      downloader.download_file(path.to_s)
    end

    it 'does not proxy when curlrc is present in CURL_HOME' do
      path = Pathname.new('some/fake/path')
      url = 'https://github.com/expo/test-repo/archive/main.tar.gz'
      opts = {}
      curl_home = '/this/is/my/home'
      downloader = Pod::Downloader::Http.new(path, url, opts)

      allow(ENV).to receive(:[]).and_call_original
      expect(ENV).to receive(:[]).with('CURL_HOME').and_return(curl_home)

      allow(File).to receive(:exist?).and_call_original
      expect(File).to receive(:exist?).at_least(1).times.with("#{curl_home}/.curlrc") { true }

      expect(downloader).to receive(:orig_download_file).once {}
      downloader.download_file(path.to_s)
    end

    it 'does not proxy when curlrc is present in XDG_CONFIG_HOME' do
      path = Pathname.new('some/fake/path')
      url = 'https://github.com/expo/test-repo/archive/main.tar.gz'
      opts = {}
      xdg_config_home = '/this/is/my/home'
      downloader = Pod::Downloader::Http.new(path, url, opts)

      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with('XDG_CONFIG_HOME').and_return(xdg_config_home)

      allow(File).to receive(:exist?).and_call_original
      expect(File).to receive(:exist?).at_least(1).times.with("#{xdg_config_home}/.curlrc") { true }

      expect(downloader).to receive(:orig_download_file).once {}
      downloader.download_file(path.to_s)
    end
  end

  def start_cdn_server(root, responses = {})
    server = LocalCdnServer.new(root, responses)
    server.start
    @started_servers ||= []
    @started_servers << server
    server
  end

  def create_local_pod_source(root, pod_name, pod_version)
    source_dir = root.join('pod-source')
    source_dir.join('Sources').mkpath
    source_dir.join('Sources', "#{pod_name}.m").write("void #{pod_name}(void) {}\n")
    run_command('git', 'init', source_dir)
    run_command('git', 'config', 'user.email', 'test@example.com', source_dir)
    run_command('git', 'config', 'user.name', 'Test', source_dir)
    run_command('git', 'add', '.', source_dir)
    run_command('git', 'commit', '-m', 'Initial commit', source_dir)
    run_command('git', 'tag', pod_version, source_dir)
    "file://#{source_dir}"
  end

  def write_cdn(root, pod_name, pod_version, source_url)
    write_cocoapods_version_file(root)
    root.join(versions_path).write("#{pod_name}/#{pod_version}\n")
    root.join('all_pods.txt').write("#{pod_name}\n")
    root.join('deprecated_podspecs.txt').write('')
    podspec_file = root.join(podspec_path)
    podspec_file.dirname.mkpath
    podspec_file.write(JSON.generate(podspec(pod_name, pod_version, source_url)))
  end

  def write_cocoapods_version_file(root)
    root.mkpath
    root.join('CocoaPods-version.yml').write(<<~YAML)
      min: 1.0.0
      last: #{Pod::VERSION}
      prefix_lengths:
      - 1
      - 1
      - 1
    YAML
  end

  def podspec(pod_name, pod_version, source_url)
    {
      name: pod_name,
      version: pod_version,
      summary: 'Local integration test pod.',
      description: 'Local integration test pod for expo-cocoapods-proxy.',
      homepage: 'https://example.com',
      license: { type: 'MIT' },
      authors: { Expo: 'support@example.com' },
      source: { git: source_url, tag: pod_version },
      source_files: 'Sources/**/*.{h,m,swift}',
      platforms: { ios: '13.0' }
    }
  end

  def run_pod_install(root, proxy_url, trunk_url)
    work_dir = root.join('app')
    work_dir.mkpath
    write_podfile(work_dir)

    stdout, stderr, status = Open3.capture3(
      pod_install_env(root, proxy_url),
      RbConfig.ruby,
      '-I',
      File.expand_path('../../lib', __dir__),
      '-e',
      pod_install_script(trunk_url),
      chdir: work_dir.to_s
    )
    { stdout: stdout, stderr: stderr, status: status, work_dir: work_dir }
  ensure
    @started_servers&.each(&:stop)
    @started_servers = nil
  end

  def write_podfile(work_dir)
    work_dir.join('Podfile').write(<<~PODFILE)
      install! 'cocoapods', :integrate_targets => false
      platform :ios, '13.0'

      target 'App' do
        pod '#{pod_name}', '#{pod_version}'
      end
    PODFILE
  end

  def pod_install_env(root, proxy_url)
    ENV.to_h.merge(
      'COCOAPODS_DISABLE_STATS' => 'true',
      'CP_CACHE_DIR' => root.join('cache').to_s,
      'CP_HOME_DIR' => root.join('home').to_s,
      'CP_REPOS_DIR' => root.join('repos').to_s,
      'EAS_BUILD_COCOAPODS_CACHE_URL' => proxy_url
    )
  end

  def pod_install_script(trunk_url)
    <<~RUBY
      require 'cocoapods'
      Pod::TrunkSource.send(:remove_const, :TRUNK_REPO_URL)
      Pod::TrunkSource.const_set(:TRUNK_REPO_URL, #{trunk_url.inspect})
      require 'cocoapods_plugin'
      Pod::Command.run(['install', '--verbose'])
    RUBY
  end

  def run_command(command, *args, cwd)
    stdout, stderr, status = Open3.capture3(command, *args, chdir: cwd.to_s)
    return if status.success?

    raise "#{command} #{args.join(' ')} failed\nSTDOUT:\n#{stdout}\nSTDERR:\n#{stderr}"
  end

  def request_paths(server)
    server.requests.map { |request| request[:path] }
  end

  def expect_pod_install_to_succeed(result)
    expect(result[:status]).to(
      be_success,
      "pod install failed\nSTDOUT:\n#{result[:stdout]}\nSTDERR:\n#{result[:stderr]}"
    )
    expect(result[:work_dir].join('Pods', pod_name, 'Sources', "#{pod_name}.m")).to exist
  end
end
