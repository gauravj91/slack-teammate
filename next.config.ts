import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Composio's SDK uses Node APIs; keep it out of the bundle.
  serverExternalPackages: ["@composio/core", "@composio/anthropic"],
};

export default nextConfig;
