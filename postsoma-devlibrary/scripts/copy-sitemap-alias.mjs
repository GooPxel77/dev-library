import { copyFile } from "node:fs/promises";

// A second, identical submission URL lets Search Console retry independently.
// Keep sitemap.xml as the canonical discovery endpoint in robots.txt.
await copyFile(new URL("../out/sitemap.xml", import.meta.url), new URL("../out/sitemap-static.xml", import.meta.url));
console.log("Created sitemap-static.xml from the exported sitemap.xml");
