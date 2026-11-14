#!/usr/bin/env bun
/**
 * 从 public/favicon.jpg 生成平台图标：32×32 favicon、180×180 apple-touch-icon
 * 与 manifest 用的 192 / 512 PNG。用 JPEG 源保证图标不透明（iOS 会把透明区域填黑）。
 * Vite 只会原样复制 public/，所以构建前先写一次。
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(appRoot, "public");
const sourcePath = join(publicRoot, "favicon.jpg");

const source = new Uint8Array(await Bun.file(sourcePath).arrayBuffer());

const targets = [
  { name: "favicon-32x32.png", size: 32 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
] as const;

for (const target of targets) {
  const bytes = await new Bun.Image(source)
    .resize(target.size, target.size, { fit: "fill" })
    .png()
    .bytes();
  await Bun.write(join(publicRoot, target.name), bytes);
}

console.log(`[icons] 生成 ${targets.length} 个图标（${targets.map(target => target.name).join(", ")}）`);
