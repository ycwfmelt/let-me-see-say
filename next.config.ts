import type { NextConfig } from "next";
import { resolve } from "path";

const __dirname = import.meta.dirname;

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      tailwindcss: resolve(__dirname, "node_modules/tailwindcss"),
      "@tailwindcss/typography": resolve(
        __dirname,
        "node_modules/@tailwindcss/typography"
      ),
    },
  },
};

export default nextConfig;
