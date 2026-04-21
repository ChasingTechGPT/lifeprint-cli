class Lifeprint < Formula
  desc "AI-powered lifestyle planning from your terminal"
  homepage "https://lifeprintpro.com/cli"
  version "0.2.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/ChasingTechGPT/lifeprint-cli/releases/download/v#{version}/lifeprint-macos-arm64"
      sha256 "4f8f61a67714599384e4373d2aa0940016da3815174cfd404c0ccf93f649fc35"
    else
      url "https://github.com/ChasingTechGPT/lifeprint-cli/releases/download/v#{version}/lifeprint-macos-x64"
      sha256 "5419ffdc053a4b0d499206dfa26da91428a4b938bde5b1177f07b3cd558cbcc8"
    end
  end

  on_linux do
    url "https://github.com/ChasingTechGPT/lifeprint-cli/releases/download/v#{version}/lifeprint-linux"
    sha256 "63e83eb6c696f66d2664037fa78a139d3fa337426e108a3fd414e5ce4c525564"
  end

  def install
    binary = Dir["lifeprint-*"].first || "lifeprint"
    bin.install binary => "lifeprint"
  end

  test do
    assert_match "lifeprint", shell_output("#{bin}/lifeprint --version")
  end
end
