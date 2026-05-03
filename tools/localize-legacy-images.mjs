import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const postsDir = path.join(rootDir, "source", "_posts");
const outputDir = path.join(rootDir, "source", "images", "posts");
const legacyPrefix = "https://cdn.jsdelivr.net/gh/SpaceDraG0n-1/images@main/img/";
const localPrefix = "/images/posts/";

fs.mkdirSync(outputDir, { recursive: true });

const postFiles = fs.readdirSync(postsDir).filter((file) => file.endsWith(".md"));
const matches = new Map();

for (const file of postFiles) {
  const filePath = path.join(postsDir, file);
  const content = fs.readFileSync(filePath, "utf8");
  const regex = new RegExp(`${legacyPrefix.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}([^\\s)\"'>]+)`, "g");
  let match;

  while ((match = regex.exec(content)) !== null) {
    matches.set(match[1], `${legacyPrefix}${match[1]}`);
  }
}

let downloaded = 0;
for (const [filename, url] of matches.entries()) {
  const targetPath = path.join(outputDir, filename);
  if (!fs.existsSync(targetPath)) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));
    downloaded += 1;
  }
}

let rewrittenFiles = 0;
for (const file of postFiles) {
  const filePath = path.join(postsDir, file);
  const content = fs.readFileSync(filePath, "utf8");
  if (!content.includes(legacyPrefix)) continue;

  const next = content.split(legacyPrefix).join(localPrefix);
  fs.writeFileSync(filePath, next, "utf8");
  rewrittenFiles += 1;
}

console.log(`localized ${matches.size} unique images`);
console.log(`downloaded ${downloaded} new files`);
console.log(`rewritten ${rewrittenFiles} posts`);
