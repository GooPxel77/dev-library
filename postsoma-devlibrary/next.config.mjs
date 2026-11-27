/** @type {import('next').NextConfig} */

const nextConfig = {
  images: {
    unoptimized: true,
  },
  optimizeFonts: false,
  async headers() {
    return [
      {
        source: "/data/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/sitemap-static.xml",
        destination: "/sitemap.xml",
      },
    ];
  },
  experimental: {
    outputFileTracingIncludes: {
      "/api/plan": [
        "./public/data/resources.json",
        "./data/github-favorites.json",
        "./data/resource-facets.json",
      ],
    },
  },
};

export default nextConfig;
