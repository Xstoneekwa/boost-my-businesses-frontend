"use client";

import { useEffect } from "react";
import original from "./MarketingPages.module.css";
import motion from "./HomeImmersiveMotion.module.css";

/** Local experiment: additive decoration only. No content, navigation or app state. */
export default function HomeImmersiveMotion() {
  useEffect(() => {
    const acquisition = document.querySelector<HTMLElement>('[data-testid="smart-acquisition-visual"]');
    const adaptive = document.querySelector<HTMLElement>('[data-testid="adaptive-growth-visual"]');
    const root = acquisition?.closest("main");
    const hero = root?.querySelector<HTMLElement>(`.${original.hero}`);
    if (!root || !hero || !acquisition || !adaptive) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = window.matchMedia("(min-width: 821px) and (pointer: fine)");
    const marked: HTMLElement[] = [];
    const decorations: HTMLElement[] = [];
    const mark = (element: HTMLElement | null, name: string) => {
      if (element && element.dataset.motionPlane !== name) { element.dataset.motionPlane = name; marked.push(element); }
    };
    mark(hero, "hero");
    mark(hero.querySelector(`.${original.previewShell}`), "preview");
    mark(hero.querySelector(`.${original.heroAura}`), "aura");
    mark(acquisition, "acquisition");
    mark(adaptive, "adaptive");
    mark(acquisition.querySelector(`.${original.acquisitionSweep}`), "calibration");
    const markEditorialPlanes = () => {
      acquisition.querySelectorAll<HTMLElement>(`.${original.integratedNarrative} article`).forEach(el => mark(el, "narrative"));
      adaptive.querySelectorAll<HTMLElement>(`.${original.integratedUseCases} article`).forEach(el => mark(el, "sector"));
    };
    markEditorialPlanes();
    // Localized keyed cards can be replaced by React. Observe only these scenes,
    // not the dynamic hero, and never observe our own attribute writes.
    const editorialObserver = new MutationObserver(markEditorialPlanes);
    editorialObserver.observe(acquisition, { childList: true, subtree: true });
    editorialObserver.observe(adaptive, { childList: true, subtree: true });

    const decorate = (parent: HTMLElement, className: string, count: number) => {
      const element = document.createElement("div");
      element.className = className;
      element.setAttribute("aria-hidden", "true");
      element.dataset.motionDecoration = "";
      for (let i = 0; i < count; i++) element.appendChild(document.createElement("i"));
      parent.appendChild(element);
      decorations.push(element);
    };
    decorate(hero, motion.heroOrbit, 2);
    decorate(adaptive, motion.spatialFrame, 3);
    decorate(acquisition, motion.convergence, 3);

    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    const visible = new Set<HTMLElement>([hero, acquisition, adaptive]);
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    const write = () => {
      frame = 0;
      if (reduce.matches || document.hidden) return;
      // Batch reads before writes. No permanent RAF loop or React scroll renders.
      const height = window.innerHeight;
      const samples = [...visible].map(element => ({ element, rect: element.getBoundingClientRect() }));
      for (const { element, rect } of samples) {
        if (element === hero) {
          hero.style.setProperty("--hero-exit", String(clamp(-rect.top / Math.max(rect.height, 1))));
          hero.style.setProperty("--pointer-x", String(pointerX));
          hero.style.setProperty("--pointer-y", String(pointerY));
        } else {
          const p = clamp((height - rect.top) / (height + rect.height));
          element.style.setProperty("--scene-p", p.toFixed(4));
          element.style.setProperty("--scene-entry", clamp(p / .4).toFixed(4));
          element.style.setProperty("--scene-focus", (Math.sin(p * Math.PI)).toFixed(4));
        }
      }
    };
    const schedule = () => {
      if (!frame && !reduce.matches && !document.hidden) frame = window.requestAnimationFrame(write);
    };
    const pointer = (event: PointerEvent) => {
      if (!desktop.matches || reduce.matches) return;
      const rect = hero.getBoundingClientRect();
      pointerX = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
      pointerY = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
      schedule();
    };
    const resetPointer = () => { pointerX = 0; pointerY = 0; schedule(); };
    const configure = () => {
      root.classList.toggle(motion.active, !reduce.matches);
      root.dataset.immersiveMotion = reduce.matches ? "reduced" : "active";
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      resetPointer();
    };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (entry.isIntersecting) visible.add(element);
        else visible.delete(element);
        element.dataset.motionInView = String(entry.isIntersecting);
      }
      schedule();
    }, { rootMargin: "160px" });
    [hero, acquisition, adaptive].forEach(element => observer.observe(element));
    configure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    document.addEventListener("visibilitychange", schedule);
    hero.addEventListener("pointermove", pointer, { passive: true });
    hero.addEventListener("pointerleave", resetPointer);
    reduce.addEventListener("change", configure);
    desktop.addEventListener("change", resetPointer);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      editorialObserver.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
      hero.removeEventListener("pointermove", pointer);
      hero.removeEventListener("pointerleave", resetPointer);
      reduce.removeEventListener("change", configure);
      desktop.removeEventListener("change", resetPointer);
      root.classList.remove(motion.active);
      delete root.dataset.immersiveMotion;
      decorations.forEach(element => element.remove());
      marked.forEach(element => {
        delete element.dataset.motionPlane;
        delete element.dataset.motionInView;
        for (const key of ["--hero-exit", "--pointer-x", "--pointer-y", "--scene-p", "--scene-entry", "--scene-focus"]) element.style.removeProperty(key);
      });
    };
  }, []);
  return null;
}
