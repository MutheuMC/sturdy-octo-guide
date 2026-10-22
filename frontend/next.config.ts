import type { NextConfig } from "next";
const apiOrigin = new URL(process.env.API_ORIGIN || "http://127.0.0.1:4000");
if (!/^https?:$/.test(apiOrigin.protocol) || apiOrigin.username || apiOrigin.password || apiOrigin.pathname !== "/" || apiOrigin.search || apiOrigin.hash) {
  throw new Error("API_ORIGIN must be an HTTP(S) origin without credentials, path, query, or fragment");
}
const config: NextConfig = {
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin.origin}/api/:path*`,
      },
    ];
  },
};
export default config;
