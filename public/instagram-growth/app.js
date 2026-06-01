/* ============================================================
   Boost My Businesses — interactions
   ============================================================ */
(function () {
  "use strict";
  var currentLang = "fr";

  /* ---------- Language ---------- */
  var STORE_LANG = "bmb_lang";
  function applyLang(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-en]").forEach(function (el) {
      if (el.dataset.fr === undefined) el.dataset.fr = el.innerHTML;
      el.innerHTML = lang === "en" ? el.dataset.en : el.dataset.fr;
    });
    document.querySelectorAll("#lang button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.lang === lang);
    });
    resetRotator();
    updateBilling();
    try { localStorage.setItem(STORE_LANG, lang); } catch (e) {}
  }
  var langEl = document.getElementById("lang");
  if (langEl) langEl.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (b) applyLang(b.dataset.lang);
  });

  /* ---------- Hero word rotator ---------- */
  var rotator = document.getElementById("rotator");
  var rotIdx = 0;
  function rotWords() {
    if (!rotator) return [];
    var src = currentLang === "en" ? rotator.dataset.wordsEn : rotator.dataset.wordsFr;
    return (src || "").split(",");
  }
  function tickRotator() {
    var w = rotWords(); if (!w.length) return;
    rotIdx = (rotIdx + 1) % w.length;
    rotator.style.transition = "opacity .25s, transform .25s";
    rotator.style.opacity = "0"; rotator.style.transform = "translateY(6px)";
    setTimeout(function () {
      rotator.textContent = w[rotIdx];
      rotator.style.opacity = "1"; rotator.style.transform = "none";
    }, 250);
  }
  function resetRotator() {
    var w = rotWords(); if (!w.length || !rotator) return;
    rotator.textContent = w[rotIdx % w.length];
  }
  if (rotator) { setInterval(tickRotator, 2200); }

  /* ---------- Pricing billing toggle ---------- */
  var NOTES = {
    m: { fr: "facturé mensuellement", en: "billed monthly" },
    q: { fr: "facturé tous les 3 mois", en: "billed every 3 months" },
    h: { fr: "facturé tous les 6 mois", en: "billed every 6 months" },
    y: { fr: "facturé sur 12 mois", en: "billed for 12 months" }
  };
  var DISCOUNT = { m: 0, q: 0.10, h: 0.20, y: 0.25 };
  var currentPeriod = "m";
  function updateBilling() {
    document.querySelectorAll("[data-price]").forEach(function (el) {
      var base = parseFloat(el.dataset.m);
      if (isNaN(base)) return;
      el.textContent = Math.round(base * (1 - DISCOUNT[currentPeriod]));
    });
    document.querySelectorAll("[data-period-note]").forEach(function (el) {
      el.textContent = NOTES[currentPeriod][currentLang];
    });
  }
  var billToggle = document.getElementById("billToggle");
  if (billToggle) billToggle.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    currentPeriod = b.dataset.period;
    billToggle.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
    updateBilling();
  });

  /* ---------- Results chart ---------- */
  var chartLine = document.getElementById("chartLine");
  var chartArea = document.getElementById("chartArea");
  var x0 = 44, x1 = 540, yBase = 260, yTop = 40;
  var flat = [0.05, 0.06, 0.07, 0.08, 0.09, 0.10, 0.11, 0.12, 0.13];
  var grow = [0.03, 0.07, 0.14, 0.24, 0.36, 0.50, 0.67, 0.85, 1.0];

  function buildPath(s) {
    var n = s.length;
    var pts = s.map(function (v, i) {
      return [x0 + (x1 - x0) * (i / (n - 1)), yBase - (yBase - yTop) * v];
    });
    var d = "M" + pts[0][0] + "," + pts[0][1];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i === 0 ? 0 : i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += "C" + (p1[0] + (p2[0] - p0[0]) / 6) + "," + (p1[1] + (p2[1] - p0[1]) / 6) +
           " " + (p2[0] - (p3[0] - p1[0]) / 6) + "," + (p2[1] - (p3[1] - p1[1]) / 6) +
           " " + p2[0] + "," + p2[1];
    }
    return d;
  }

  function setChart(state) {
    if (!chartLine) return;
    var d = buildPath(state === "with" ? grow : flat);
    var svg = document.getElementById("chartSvg");
    if (svg) svg.style.setProperty("--chart-stroke", state === "with" ? "#10b981" : "#f43f5e");
    chartLine.setAttribute("d", d);
    if (chartArea) chartArea.setAttribute("d", d + " L" + x1 + "," + yBase + " L" + x0 + "," + yBase + " Z");
    document.querySelectorAll("#chartToggle button").forEach(function (b) {
      var on = b.dataset.state === state;
      b.classList.toggle("bad-on", on && state === "without");
      b.classList.toggle("good-on", on && state === "with");
    });
  }

  var chartState = "without";
  var chartTimer = null;
  function cycleChart() {
    chartState = chartState === "without" ? "with" : "without";
    setChart(chartState);
  }
  function startChartAuto() {
    if (chartTimer) clearInterval(chartTimer);
    chartTimer = setInterval(cycleChart, 3200);
  }

  var ct = document.getElementById("chartToggle");
  if (ct) ct.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    chartState = b.dataset.state;
    setChart(chartState);
    startChartAuto();
  });

  setChart("without");

  var chartSvg = document.getElementById("chartSvg");
  if (chartSvg && "IntersectionObserver" in window) {
    var cio = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (en.isIntersecting) { startChartAuto(); }
        else if (chartTimer) { clearInterval(chartTimer); chartTimer = null; }
      });
    }, { threshold: 0.3 });
    cio.observe(chartSvg);
  } else {
    startChartAuto();
  }

  /* ---------- Demo video ---------- */
  var demoVideo = document.getElementById("demoVideo");
  var videoPh = document.getElementById("videoPh");
  var videoPlay = document.getElementById("videoPlay");
  if (demoVideo && videoPlay) {
    videoPlay.addEventListener("click", function () {
      demoVideo.play().then(function () {
        if (videoPh) videoPh.style.display = "none";
        demoVideo.setAttribute("controls", "");
      }).catch(function () {
        // No video file yet — keep placeholder visible
      });
    });
  }

  /* ---------- FAQ accordion ---------- */
  var faq = document.querySelector(".faq");
  if (faq) faq.addEventListener("click", function (e) {
    var q = e.target.closest(".faq-q"); if (!q) return;
    var item = q.parentElement;
    var isOpen = item.classList.contains("open");
    faq.querySelectorAll(".faq-item.open").forEach(function (x) { x.classList.remove("open"); });
    if (!isOpen) item.classList.add("open");
  });

  /* ---------- Scroll reveal ---------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });

  /* ---------- Init ---------- */
  var saved = "fr";
  try { saved = localStorage.getItem(STORE_LANG) || "fr"; } catch (e) {}
  applyLang(saved);
})();
