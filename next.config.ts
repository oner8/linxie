import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/strokes/*": ["./node_modules/hanzi-writer-data/*.json", "./node_modules/hanzi-writer-data/ARPHICPL.TXT", "./node_modules/hanzi-writer/LICENSE"],
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), screen-wake-lock=(self)" },
    ] }];
  },
};
export default config;
