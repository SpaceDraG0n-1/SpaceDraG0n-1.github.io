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
- 已启用 Hexo 官方文章资源目录工作流

## 关键文件

- 站点基础配置：[`_config.yml`](./_config.yml)
- 主题配置：[`_config.redefine.yml`](./_config.redefine.yml)
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

## 以后如果你再搬旧文章

如果还有旧文里的图片还挂在原来的 `jsDelivr` 图床上，可以再次执行：

```bash
npm run images:localize
```

它会自动下载旧图并改写文章链接。
