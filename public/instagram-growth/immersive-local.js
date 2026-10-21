/* Local-only presentation layer. Never writes content, links, storage or events. */
(() => {
  'use strict';
  const root = document.body;
  if (root.dataset.igImmersive) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const small = matchMedia('(max-width: 700px)');
  const scenes = [...document.querySelectorAll('.hero, #demo, .feature-visual-card, .industry-system-visual, #pricing')];
  const visible = new Set();
  let frame = 0;
  let pointer = null;
  let pointerTarget = null;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // Empty decorative elements only: original semantic DOM remains intact.
  const hero = document.querySelector('.hero');
  const portal = document.createElement('div');
  portal.className = 'ig-depth-portal';
  portal.setAttribute('aria-hidden', 'true');
  hero?.prepend(portal);
  root.classList.add('ig-immersive');

  function draw() {
    frame = 0;
    if (reduced.matches || document.hidden) return;
    const height = innerHeight;
    // All geometry reads precede writes. Only viewport scenes are sampled.
    const updates = [...visible].map(el => {
      const box = el.getBoundingClientRect();
      const progress = clamp((height - box.top) / (height + box.height), 0, 1);
      return { el, progress };
    });
    const box = pointerTarget && pointer ? pointerTarget.getBoundingClientRect() : null;
    for (const { el, progress } of updates) {
      el.style.setProperty('--ig-p', progress.toFixed(4));
      el.style.setProperty('--ig-travel', ((progress - .5) * (small.matches ? 7 : 30)).toFixed(2) + 'px');
      el.style.setProperty('--ig-angle', ((progress - .5) * (small.matches ? 0 : 3)).toFixed(2) + 'deg');
      if (el.matches('.industry-system-visual')) {
        const stage = clamp(Math.floor((progress - .2) * 10), 0, 5);
        el.dataset.igStage = String(stage);
      }
    }
    if (box && pointerTarget) {
      const x = clamp((pointer.x - box.left) / box.width, 0, 1);
      const y = clamp((pointer.y - box.top) / box.height, 0, 1);
      pointerTarget.style.setProperty('--ig-x', (x * 100).toFixed(1) + '%');
      pointerTarget.style.setProperty('--ig-y', (y * 100).toFixed(1) + '%');
      pointerTarget.style.setProperty('--ig-rx', ((.5 - y) * 1.8).toFixed(2) + 'deg');
      pointerTarget.style.setProperty('--ig-ry', ((x - .5) * 1.8).toFixed(2) + 'deg');
    }
  }
  function schedule() {
    if (!frame && !reduced.matches && !document.hidden) frame = requestAnimationFrame(draw);
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
      entry.target.classList.toggle('ig-in-view', entry.isIntersecting);
    }
    schedule();
  }, { rootMargin: '80px 0px', threshold: 0 });
  scenes.forEach(el => observer.observe(el));
  function resetPointer() {
    if (pointerTarget) {
      ['--ig-rx', '--ig-ry', '--ig-x', '--ig-y'].forEach(k => pointerTarget.style.removeProperty(k));
    }
    pointerTarget = null;
    pointer = null;
  }
  function move(event) {
    if (!fine.matches || small.matches || reduced.matches) return;
    const target = event.target.closest('.hero, .plan');
    if (target !== pointerTarget) { resetPointer(); pointerTarget = target; }
    if (!target) return;
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  }
  function configure() {
    root.dataset.igImmersive = reduced.matches ? 'reduced' : 'active';
    resetPointer();
    if (reduced.matches) {
      cancelAnimationFrame(frame); frame = 0;
      scenes.forEach(el => ['--ig-p', '--ig-travel', '--ig-angle'].forEach(k => el.style.removeProperty(k)));
    } else schedule();
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerleave', resetPointer);
  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener('change', configure);
  small.addEventListener('change', configure);
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(frame); frame = 0; resetPointer();
  });
  window.addEventListener('pageshow', schedule);
  configure();
})();
