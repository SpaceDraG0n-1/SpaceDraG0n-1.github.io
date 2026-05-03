(function () {
  const host = window.location.hostname;
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".local");

  if (isLocal) return;

  const rasterExt = /\.(avif|gif|jpe?g|png|webp)$/i;
  const siteAssetPrefix = "/images/";

  const optimize = (src) => {
    if (!src || src.startsWith("/cdn-cgi/image/")) return src;
    if (!src.startsWith(siteAssetPrefix) || !rasterExt.test(src)) return src;

    return `/cdn-cgi/image/format=auto,quality=82,fit=scale-down,width=1600${src}`;
  };

  const apply = (img) => {
    if (!(img instanceof HTMLImageElement)) return;

    const dataSrc = img.getAttribute("data-src");
    if (dataSrc) {
      const optimized = optimize(dataSrc);
      if (optimized !== dataSrc) {
        img.setAttribute("data-src", optimized);
      }
      return;
    }

    const src = img.getAttribute("src");
    const optimized = optimize(src);
    if (optimized !== src) {
      img.setAttribute("src", optimized);
    }
  };

  const scan = () => {
    document
      .querySelectorAll(".article-content img, .post-content img, .markdown-body img")
      .forEach(apply);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan, { once: true });
  } else {
    scan();
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
})();
