# SpaceDraG0n Blog

一个基于 `Hexo + Redefine` 的个人博客，当前默认按 `GitHub Pages` 免费部署来维护，重点是：

- 保留简洁技术博客风格
- 兼顾中国大陆和海外访问
- 正文截图已本地化，不再依赖旧 GitHub 图床
- 文章图片支持更省事的本地资源目录写法

## 本地运行

```bash
npm install
npm run server
```

默认预览地址：

```text
http://localhost:4000
```

如果 `4000` 端口被占用：

```bash
npm run server -- --port 4321
```

## 这次已经帮你处理好的内容

- `Hexo + Redefine` 站点骨架
- 首页、About、Archives、Tags、Categories、Friends、404 页面
- 从旧博客迁移过来的 9 篇文章
- 旧文章中的 `98` 张截图已迁到 `source/images/posts/`
- `GitHub Pages` 自动部署工作流
- `Cloudflare` 缓存头配置：`source/_headers`
- 生产环境图片优化脚本：`source/js/cloudflare-image-loader.js`
- 已启用 Hexo 官方文章资源目录工作流

## 关键文件

- 站点基础配置：[`_config.yml`](./_config.yml)
- 主题配置：[`_config.redefine.yml`](./_config.redefine.yml)
- Cloudflare 响应头：[`source/_headers`](./source/_headers)
- 旧图迁移脚本：[`tools/localize-legacy-images.mjs`](./tools/localize-legacy-images.mjs)

## 更省事的插图方式

已经按 Hexo 官方的文章资源目录模式配置好了：

- `post_asset_folder: true`
- `marked.postAsset: true`

以后发新文章时用：

```bash
npm run new:post -- "文章标题"
```

Hexo 会自动创建：

- `source/_posts/文章标题.md`
- `source/_posts/文章标题/`

你后面只需要：

1. 把这篇文章的图片丢进同名文件夹 `source/_posts/文章标题/`
2. 在 markdown 里直接写：

```md
![](image.png)
```

这样就不用再手写 `/images/posts/xxx.png` 了。

如果你用 Typora 之类编辑器，建议把“插入图片时复制到相对目录”打开，之后拖图进文章会更顺手。

## GitHub Pages 发布

当前仓库已经带好 GitHub Actions 部署文件 [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)。

你只要把项目推到 `SpaceDraG0n-1/SpaceDraG0n-1.github.io`，GitHub 就会在 `main` 分支更新后自动构建并发布。

如果是第一次启用 Pages，到 GitHub 仓库里确认：

1. 进入 `Settings -> Pages`
2. `Source` 选择 `GitHub Actions`

发布地址就是：

```text
https://spacedrag0n-1.github.io
```

## 上线前你要改的地方

1. 如果你继续用 GitHub Pages，保持 [`_config.yml`](./_config.yml) 和 [`_config.redefine.yml`](./_config.redefine.yml) 里的 URL 为 `https://spacedrag0n-1.github.io`
2. 按需要修改 [`source/about/index.md`](./source/about/index.md) 的个人介绍
3. 如果你要首页社交图标，把 [`_config.redefine.yml`](./_config.redefine.yml) 里的 `home_banner.social_links.enable` 改成 `true`，再填 GitHub / 邮箱链接

## Cloudflare Pages 部署

这部分现在是可选方案，不是当前默认方案。

### 方案 A: 控制台接 Git 仓库

这是最省心的长期方案。

1. 把当前项目推到 GitHub 或 GitLab
2. 在 Cloudflare 后台进入 `Workers & Pages`
3. 创建 `Pages` 项目并导入仓库
4. 构建配置填写：

```text
Production branch: main
Build command: npm run build
Build output directory: public
```

5. 在项目里绑定你的正式域名 `spacedragon.com`

### 方案 B: 不接 Git，直接上传

如果你不想依赖 Git 平台，可以直接用 `wrangler` 上传构建结果。

先登录：

```bash
npx wrangler login
```

首次创建项目：

```bash
npm run cf:project
```

构建并上传：

```bash
npm run build
npm run cf:deploy -- --project-name=<你的-pages-项目名>
```

如果只是想发一个预览分支：

```bash
npm run cf:preview -- --project-name=<你的-pages-项目名>
```

## 图片和访问优化说明

现在博客里的正文截图已经是站内资源，后续访问链路会变成：

```text
你的域名 -> Cloudflare Pages -> 站内图片资源
```

生产环境下，脚本会把站内位图交给 Cloudflare 的 `/cdn-cgi/image/...` 路径处理，用于：

- 自动选择更合适的格式
- 压缩大图
- 减少首屏和正文图的实际传输体积

本地 `localhost` 预览时不会启用这层改写，避免影响开发。

## 以后如果你再搬旧文章

如果还有旧文里的图片还挂在原来的 `jsDelivr` 图床上，可以再次执行：

```bash
npm run images:localize
```

它会自动下载旧图并改写文章链接。
