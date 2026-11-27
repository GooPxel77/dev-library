/** @type {import('next').NextConfig} */

const nextConfig = {
  images: {
    unoptimized: true,
  },
  optimizeFonts: false,
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
