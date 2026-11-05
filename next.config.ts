import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["sharp", "exceljs", "onnxruntime-node"],
};

export default nextConfig;
