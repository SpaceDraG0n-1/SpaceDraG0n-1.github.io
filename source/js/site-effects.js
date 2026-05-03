(function () {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarsePointer = window.matchMedia("(pointer: coarse)");
  const state = {
    bannerFx: null,
    revealObserver: null,
    bootQueued: false,
    clickInstalled: false,
    globalInstalled: false,
    swupHookInstalled: false,
  };

  function queueBoot() {
    if (state.bootQueued) return;
    state.bootQueued = true;

    requestAnimationFrame(() => {
      state.bootQueued = false;
      boot();
    });
  }

  function boot() {
    installReveal();
    mountBannerParticles();
  }

  function installReveal() {
    if (prefersReducedMotion.matches) return;

    if (!state.revealObserver) {
      state.revealObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("is-visible");
            state.revealObserver.unobserve(entry.target);
          }
        },
        {
          threshold: 0.14,
          rootMargin: "0px 0px -8% 0px",
        },
      );
    }

    const targets = document.querySelectorAll(
      ".home-article-item, .page-template-container, .article-content-container, .card-widget",
    );

    targets.forEach((element, index) => {
      if (element.dataset.fxRevealReady === "1") return;

      element.dataset.fxRevealReady = "1";
      element.classList.add("fx-reveal");
      element.style.setProperty("--fx-delay", `${Math.min(index % 6, 5) * 55}ms`);
      state.revealObserver.observe(element);
    });
  }

  function destroyBannerParticles() {
    if (!state.bannerFx) return;

    const { canvas, glow, resizeObserver, onPointerMove, onPointerLeave, banner, rafId } = state.bannerFx;

    cancelAnimationFrame(rafId);
    if (resizeObserver) resizeObserver.disconnect();
    if (banner) {
      banner.removeEventListener("pointermove", onPointerMove);
      banner.removeEventListener("pointerleave", onPointerLeave);
    }
    canvas.remove();
    glow.remove();
    state.bannerFx = null;
  }

  function mountBannerParticles() {
    const banner = document.querySelector(".home-banner");

    if (!banner || prefersReducedMotion.matches) {
      destroyBannerParticles();
      return;
    }

    if (state.bannerFx && state.bannerFx.banner === banner) return;

    destroyBannerParticles();

    const canvas = document.createElement("canvas");
    const glow = document.createElement("div");
    canvas.className = "fx-particle-canvas";
    glow.className = "fx-ambient-glow";
    banner.appendChild(canvas);
    banner.appendChild(glow);

    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles = [];
    let rafId = 0;
    const pointer = { x: 0.5, y: 0.42, active: false };

    function createParticle() {
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.16 - 0.02,
        radius: Math.random() * 1.8 + 0.8,
        alpha: Math.random() * 0.46 + 0.24,
        hue: Math.random() > 0.7 ? 24 : 198,
      };
    }

    function resize() {
      const rect = banner.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const density = coarsePointer.matches ? 26 : 42;
      const desiredCount = Math.max(18, Math.min(density, Math.round((width * height) / 32000)));
      particles = Array.from({ length: desiredCount }, createParticle);
    }

    function drawParticle(particle) {
      const gradient = context.createRadialGradient(
        particle.x,
        particle.y,
        0,
        particle.x,
        particle.y,
        particle.radius * 8,
      );

      const alpha = particle.alpha * (pointer.active ? 1.08 : 0.92);
      const core =
        particle.hue === 24
          ? `rgba(255, 199, 156, ${alpha})`
          : `rgba(166, 223, 255, ${alpha})`;
      const edge =
        particle.hue === 24
          ? "rgba(255, 199, 156, 0)"
          : "rgba(166, 223, 255, 0)";

      gradient.addColorStop(0, core);
      gradient.addColorStop(1, edge);

      context.fillStyle = gradient;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.radius * 8, 0, Math.PI * 2);
      context.fill();
    }

    function drawConnections() {
      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const first = particles[i];
          const second = particles[j];
          const dx = first.x - second.x;
          const dy = first.y - second.y;
          const distanceSquared = dx * dx + dy * dy;

          if (distanceSquared > 110 * 110) continue;

          const opacity = (1 - distanceSquared / (110 * 110)) * 0.085;
          context.strokeStyle = `rgba(220, 236, 244, ${opacity})`;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(first.x, first.y);
          context.lineTo(second.x, second.y);
          context.stroke();
        }
      }
    }

    function animate() {
      context.clearRect(0, 0, width, height);

      const driftX = (pointer.x - 0.5) * 10;
      const driftY = (pointer.y - 0.5) * 8;

      particles.forEach((particle, index) => {
        particle.x += particle.vx + driftX * 0.002 * (index % 3 === 0 ? -1 : 1);
        particle.y += particle.vy + driftY * 0.0015;

        if (particle.x < -24) particle.x = width + 24;
        if (particle.x > width + 24) particle.x = -24;
        if (particle.y < -24) particle.y = height + 24;
        if (particle.y > height + 24) particle.y = -24;

        drawParticle(particle);
      });

      drawConnections();
      rafId = requestAnimationFrame(animate);
      state.bannerFx.rafId = rafId;
    }

    function onPointerMove(event) {
      const rect = banner.getBoundingClientRect();
      pointer.active = true;
      pointer.x = (event.clientX - rect.left) / rect.width;
      pointer.y = (event.clientY - rect.top) / rect.height;
      glow.style.setProperty("--fx-glow-x", `${(pointer.x * 100).toFixed(2)}%`);
      glow.style.setProperty("--fx-glow-y", `${(pointer.y * 100).toFixed(2)}%`);
    }

    function onPointerLeave() {
      pointer.active = false;
      pointer.x = 0.5;
      pointer.y = 0.42;
      glow.style.setProperty("--fx-glow-x", "50%");
      glow.style.setProperty("--fx-glow-y", "42%");
    }

    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;

    state.bannerFx = {
      banner,
      canvas,
      glow,
      resizeObserver,
      onPointerMove,
      onPointerLeave,
      rafId,
    };

    resize();
    animate();
    banner.addEventListener("pointermove", onPointerMove);
    banner.addEventListener("pointerleave", onPointerLeave);
    if (resizeObserver) resizeObserver.observe(banner);
  }

  function createClickBurst(event) {
    if (event.button !== 0) return;

    const burst = document.createElement("span");
    burst.className = "fx-click-burst";
    burst.style.left = `${event.clientX}px`;
    burst.style.top = `${event.clientY}px`;

    const sparkCount = event.pointerType === "touch" ? 5 : 7;
    for (let i = 0; i < sparkCount; i += 1) {
      const spark = document.createElement("i");
      spark.style.setProperty("--fx-rotate", `${(360 / sparkCount) * i + Math.random() * 18}deg`);
      spark.style.setProperty("--fx-distance", `${12 + Math.random() * 16}px`);
      spark.style.setProperty("--fx-hue", i % 2 === 0 ? "24" : "196");
      burst.appendChild(spark);
    }

    document.body.appendChild(burst);
    window.setTimeout(() => burst.remove(), 760);
  }

  function attachSwupHooks(swup) {
    if (state.swupHookInstalled || !swup || !swup.hooks || typeof swup.hooks.on !== "function") return;

    swup.hooks.on("page:view", queueBoot);
    swup.hooks.on("content:replace", queueBoot);
    state.swupHookInstalled = true;
  }

  function installGlobalBehaviors() {
    if (!state.clickInstalled && !prefersReducedMotion.matches) {
      state.clickInstalled = true;
      document.addEventListener("pointerdown", createClickBurst, { passive: true });
    }

    if (state.globalInstalled) return;
    state.globalInstalled = true;

    attachSwupHooks(window.swup);
    window.addEventListener("redefine:swup:ready", (event) => attachSwupHooks(event.detail && event.detail.swup));
    window.addEventListener("pageshow", queueBoot);
  }

  installGlobalBehaviors();
  queueBoot();
})();
