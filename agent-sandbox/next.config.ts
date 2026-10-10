import type { NextConfig } from "next";

const config: NextConfig = {
  // Keep the dev overlay badge out of agents' screenshots and element lists.
  devIndicators: false,
};

export default config;
