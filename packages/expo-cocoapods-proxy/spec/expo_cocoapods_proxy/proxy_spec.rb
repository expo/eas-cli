# frozen_string_literal: true

require 'pathname'

RSpec.describe ExpoCocoaPodsProxy do
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
end
