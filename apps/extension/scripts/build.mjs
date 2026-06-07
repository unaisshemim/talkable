import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const appRoot = join(root, "..");
const dist = join(appRoot, "dist");

await rm(dist, {
  recursive: true,
  force: true
});
await mkdir(dist, {
  recursive: true
});

await cp(join(appRoot, "manifest.json"), join(dist, "manifest.json"));
await mkdir(join(dist, "src"), {
  recursive: true
});
await cp(join(appRoot, "src", "popup"), join(dist, "src", "popup"), {
  recursive: true
});
await cp(join(appRoot, "assets"), join(dist, "assets"), {
  recursive: true
});
await build({
  configFile: join(appRoot, "vite.config.ts")
});

console.log(`Extension copied to ${dist}`);
