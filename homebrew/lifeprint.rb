class Lifeprint < Formula
  desc "AI-powered lifestyle planning from your terminal"
  homepage "https://lifeprintpro.com/cli"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/ChasingTechGPT/lifeprint-cli/releases/download/v#{version}/lifeprint-macos-arm64"
      sha256 "fa6a4ed2cbbba262d1e096578ad2d5aad338ec7a1ef25a36bf978ac3ca4f84cb"
    else
      url "https://github.com/ChasingTechGPT/lifeprint-cli/releases/download/v#{version}/lifeprint-macos-x64"
      sha256 "20615628e0fbb08cb28a89deb9df491dceb489e19ec7bb21cc2ae9eac9bcb0da"
    end
  end

  on_linux do
    url "https://github.com/ChasingTechGPT/lifeprint-cli/releases/download/v#{version}/lifeprint-linux"
    sha256 "ab6b207ae60ccf199ad04fdab614cdba4df3ba1a3c72d7014f1486a9eedf405a"
  end

  def install
    binary = Dir["lifeprint-*"].first || "lifeprint"
    bin.install binary => "lifeprint"
  end

  test do
    assert_match "lifeprint", shell_output("#{bin}/lifeprint --version")
  end
end
