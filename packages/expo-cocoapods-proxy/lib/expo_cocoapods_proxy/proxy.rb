# frozen_string_literal: true

require 'cocoapods'
require 'cocoapods-downloader'
require 'uri'

module Pod
  module Downloader
    # Concrete Downloader class that provides support for proxying.
    class Http
      NETRC_FILENAME = '.netrc'
      NETRC_ENV_VAR = 'NETRC'
      CURLRC_FILENAME = '.curlrc'
      CURL_HOME_ENV_VAR = 'CURL_HOME'
      XDG_CONFIG_HOME_ENV_VAR = 'XDG_CONFIG_HOME'
      ALLOWLIST = [
        %r{https?://(api\.)?github\.com/},
        %r{https?://sourceforge\.net/},
        %r{https?://repo1\.maven\.org/},
        %r{https?://boostorg\.jfrog\.io/},
        %r{https?://www\.sqlite\.org/},
        %r{https?://download\.videolan\.org/},
        %r{https?://raw\.githubusercontent\.com/}
      ].freeze

      alias orig_download_file download_file

      def download_file_via_proxy(full_filename)
        orig_url = url
        @url = rewrite(url)

        begin
          orig_download_file(full_filename)
        rescue ::StandardError
          @url = orig_url
          orig_download_file(full_filename)
        end
      end

      def download_file(full_filename)
        return orig_download_file(full_filename) unless should_proxy?

        download_file_via_proxy(full_filename)
      end

      private

      def should_proxy?
        return false unless proxy
        return false if netrc_present?
        return false if curlrc_present?
        return false unless headers.nil?

        allowed?
      end

      def netrc_present?
        File.exist?(File.expand_path("~/#{NETRC_FILENAME}")) || ENV[NETRC_ENV_VAR]
      end

      def curlrc_present?
        prefix = ENV[CURL_HOME_ENV_VAR] || ENV[XDG_CONFIG_HOME_ENV_VAR] || Dir.home
        File.exist?(File.join(prefix, CURLRC_FILENAME))
      end

      def allowed?
        ALLOWLIST.any? { |reg| reg.match?(url) }
      end

      def proxy
        ENV['EAS_BUILD_COCOAPODS_CACHE_URL']
      end

      def parsed_url
        @parsed_url ||= URI.parse(url)
      end

      def rewrite(url)
        url.gsub("#{parsed_url.scheme}://#{parsed_url.host}", "#{proxy}/#{parsed_url.host}")
      end
    end

    # Concrete Downloader class that provides support for fetching GitHub
    # tarballs directly.
    class Git
      ALLOWLIST = [
        %r{https://github.com/}
      ].freeze

      alias orig_download! download!
      alias orig_checkout_options checkout_options

      def download_from_github!
        ref = options[:commit] || options[:tag] || options[:branch]
        download_url = github_url_from_ref(ref)

        begin
          Http.new(target_path, download_url, {}).download
        rescue ::StandardError
          # primarily intended in the case of a private repo that the above will
          # fail on
          FileUtils.remove_dir(target_path, true)
          orig_download!
        end
      end

      def download!
        return orig_download! unless should_proxy?

        download_from_github!
      end

      def checkout_options
        # this should work almost always
        orig_checkout_options
      rescue ::StandardError
        hash_from_github
      end

      private

      def should_proxy?
        proxy && allowed? && !options[:submodules]
      end

      def allowed?
        ALLOWLIST.any? { |reg| reg.match?(url) }
      end

      def proxy
        ENV['EAS_BUILD_COCOAPODS_CACHE_URL']
      end

      def github_url_from_ref(ref)
        base_url = url.chomp('.git').chomp('/')

        return "#{base_url}/archive/#{ref}.tar.gz" unless ref.nil?

        api_url = base_url.gsub('https://github.com/', 'https://api.github.com/repos/')
        "#{api_url}/tarball"
      end

      def hash_from_github
        return options[:commit] if options[:commit]
        return options[:tag] if options[:tag]

        command = [
          'ls-remote',
          '--',
          url,
          options[:branch]
        ]

        output = Git.execute_command('git', command)
        match = commit_from_ls_remote(output, options[:branch])
        # we didn't find the commit, so just return something
        return 'deadbeef' if match.nil?

        match
      end

      def commit_from_ls_remote(output, branch_name)
        return nil if branch_name.nil?

        encoded_branch_name = branch_name.dup.force_encoding(Encoding::ASCII_8BIT)
        match = %r{([a-z0-9]*)\trefs\/(heads|tags)\/#{Regexp.quote(encoded_branch_name)}}.match(output) # rubocop:disable Style/RedundantRegexpEscape
        match[1] unless match.nil?
      end
    end
  end
end
