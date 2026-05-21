import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/upload": [
      "node_modules/pdfjs-dist/legacy/build/**/*",
      "node_modules/pdfjs-dist/legacy/image_decoders/**/*",
      "node_modules/pdfjs-dist/standard_fonts/**/*",
      "node_modules/pdfjs-dist/cmaps/**/*",
      "node_modules/pdfjs-dist/wasm/**/*",
    ],
  },
};

export default nextConfig;

