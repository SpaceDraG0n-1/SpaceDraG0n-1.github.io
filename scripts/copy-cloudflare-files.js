"use strict";

const fs = require("node:fs");
const path = require("node:path");

hexo.extend.filter.register("after_generate", () => {
  const copies = ["_headers", "_redirects"];

  for (const name of copies) {
    const sourcePath = path.join(hexo.source_dir, name);
    const targetPath = path.join(hexo.public_dir, name);

    if (!fs.existsSync(sourcePath)) continue;
    fs.copyFileSync(sourcePath, targetPath);
  }
});
