/* ==================================================================
   SIMPLEX · capa motion
   Leyes: todo valor de scroll es función pura del progreso del track;
   escrituras directas al DOM desde el callback (nada de estado acumulado);
   mobile y reduced motion son caminos propios (html.m-static).
   Depende de: gsap + ScrollTrigger + Lenis (CDN jsdelivr).
   ================================================================== */
(function () {
  "use strict";

  var root = document.documentElement;
  var STATIC = root.classList.contains("m-static");
  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

  // Cruzar el breakpoint cambia de camino: recargamos para no mezclar estados.
  var mq = window.matchMedia("(max-width: 820px), (prefers-reduced-motion: reduce)");
  var onMq = function () { if (mq.matches !== STATIC) location.reload(); };
  if (mq.addEventListener) mq.addEventListener("change", onMq); else mq.addListener(onMq);

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function win(p, a, b) { return clamp01((p - a) / (b - a)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  /** Oculta un elemento según t (0 visible → 1 fuera). */
  function hide(el, t, cut) {
    if (!el) return;
    el.style.opacity = String(1 - t);
    el.style.visibility = t > (cut == null ? 0.98 : cut) ? "hidden" : "visible";
  }

  /* ---------------- Cascada letra por letra ---------------- */
  // parts: [{ t: "texto", cls: "clase opcional" }]
  function buildWord(parts, opts) {
    opts = opts || {};
    var word = document.createElement("span");
    word.className = "m-cas-word";
    var n = 0;
    parts.forEach(function (part) {
      var words = part.t.split(/(\s+)/);
      words.forEach(function (w) {
        if (!w) return;
        if (/^\s+$/.test(w)) { word.appendChild(document.createTextNode(" ")); return; }
        var wrap = document.createElement("span");
        wrap.className = "m-cas-w" + (part.cls ? " " + part.cls : "");
        for (var i = 0; i < w.length; i++) {
          var ch = document.createElement("span");
          ch.className = "m-cas-ch";
          ch.textContent = w[i];
          wrap.appendChild(ch);
          if (ch.animate && !REDUCED) {
            ch.animate(
              [
                { transform: "translateY(0.85em)", filter: "blur(10px)", opacity: 0 },
                { transform: "translateY(0)", filter: "blur(0px)", opacity: 1 }
              ],
              { duration: 700, delay: (opts.delay || 0) + n * (opts.stagger || 30), easing: EASE, fill: "backwards" }
            );
          }
          n++;
        }
        word.appendChild(wrap);
      });
    });
    return word;
  }

  function cascade(container, parts, opts) {
    // salientes: se desenfocan hacia arriba y se van
    $$(".m-cas-word", container).forEach(function (old) {
      if (old.dataset.leaving) return;
      old.dataset.leaving = "1";
      var chs = $$(".m-cas-ch", old);
      chs.forEach(function (c, j) {
        if (!c.animate || REDUCED) return;
        c.animate(
          [
            { transform: "translateY(0)", filter: "blur(0px)", opacity: 1 },
            { transform: "translateY(-0.55em)", filter: "blur(8px)", opacity: 0 }
          ],
          { duration: 400, delay: j * 16, easing: "ease-in", fill: "forwards" }
        );
      });
      setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, REDUCED ? 0 : 420 + chs.length * 16);
    });
    container.appendChild(buildWord(parts, opts));
  }

  /* ---------------- Swap de bloque de texto (sube y sale) ---------------- */
  function swapBlock(container, html) {
    $$(".m-swap-item", container).forEach(function (old) {
      if (old.dataset.leaving) return;
      old.dataset.leaving = "1";
      if (old.animate && !REDUCED) {
        old.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-1.2em)", opacity: 0 }],
          { duration: 450, easing: EASE, fill: "forwards" });
      }
      setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, REDUCED ? 0 : 460);
    });
    var item = document.createElement("div");
    item.className = "m-swap-item";
    item.innerHTML = html;
    container.appendChild(item);
    if (item.animate && !REDUCED) {
      item.animate([{ transform: "translateY(1.2em)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }],
        { duration: 450, easing: EASE, fill: "backwards" });
    }
  }

  /* ---------------- Nav: claro u oscuro según lo que tiene debajo ---------------- */
  function initNavTheme() {
    var nav = $("#site-nav");
    if (!nav || !document.elementsFromPoint) return;
    var queued = false;
    function check() {
      queued = false;
      var y = Math.min(40, nav.offsetHeight / 2 + 4);
      var els = document.elementsFromPoint(root.clientWidth / 2, y);
      for (var i = 0; i < els.length; i++) {
        if (nav.contains(els[i])) continue;
        var s = els[i].closest("[data-nav]");
        nav.classList.toggle("on-ink", !!s && s.getAttribute("data-nav") === "dark");
        return;
      }
    }
    function queue() { if (!queued) { queued = true; requestAnimationFrame(check); } }
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    window.navThemeCheck = queue;
    check();
  }

  /* ==================================================================
     A · Hero: secuencia de frames scrubbeada + overlay que sale por sus bordes
     ================================================================== */
  function initHero() {
    var track = $(".mhero");
    if (!track) return;
    var canvas = $(".mhero-canvas", track);
    var ctx = canvas.getContext("2d");
    var N = parseInt(track.getAttribute("data-frames") || "61", 10);
    var base = track.getAttribute("data-frames-path") || "hero/frames/";
    var frames = new Array(N);
    var target = 0, drawn = -1, ready = false;

    // Orden de carga progresivo: primero extremos y mitades, después se rellena.
    var order = [], seen = {};
    for (var step = N - 1; step >= 1; step = Math.floor(step / 2)) {
      for (var k = 0; k < N; k += step) if (!seen[k]) { seen[k] = 1; order.push(k); }
      if (step === 1) break;
    }
    for (var r = 0; r < N; r++) if (!seen[r]) order.push(r);

    var inflight = 0;
    function pump() {
      while (inflight < 6 && order.length) {
        (function (i) {
          inflight++;
          var im = new Image();
          im.decoding = "async";
          im.onload = function () { frames[i] = im; inflight--; requestDraw(); pump(); };
          im.onerror = function () { inflight--; pump(); };
          im.src = base + String(i + 1).padStart(3, "0") + ".webp";
        })(order.shift());
      }
    }
    pump();

    function nearest(i) {
      if (frames[i]) return i;
      for (var d = 1; d < N; d++) {
        if (i - d >= 0 && frames[i - d]) return i - d;
        if (i + d < N && frames[i + d]) return i + d;
      }
      return -1;
    }
    function size() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      drawn = -1;
      draw();
    }
    function draw() {
      var i = nearest(target);
      if (i < 0 || i === drawn) return;
      var im = frames[i];
      var cw = canvas.width, ch = canvas.height;
      var s = Math.max(cw / im.naturalWidth, ch / im.naturalHeight);
      var w = im.naturalWidth * s, h = im.naturalHeight * s;
      ctx.drawImage(im, (cw - w) / 2, (ch - h) / 2, w, h);
      drawn = i;
      if (!ready) { ready = true; canvas.classList.add("ready"); }
    }
    var raf = 0;
    function requestDraw() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; draw(); }); }

    var c1 = $(".mh-c1", track), c2 = $(".mh-c2", track), c3 = $(".mh-c3", track);
    var right = $(".mh-right", track), mark = $(".mh-mark", track);
    var caption = $(".mh-caption", track), hint = $(".mh-hint", track);

    function exitX(el, t, vw) {
      if (!el) return;
      el.style.transform = "translate3d(" + (vw * t).toFixed(3) + "vw,0,0)";
      el.style.opacity = String(1 - t);
      el.style.visibility = 1 - t < 0.02 ? "hidden" : "visible";
    }

    function apply(p) {
      // Los frames recorren el 72% del track; el resto lo paga el cover handoff.
      target = Math.round(win(p, 0, 0.72) * (N - 1));
      requestDraw();

      exitX(c1, win(p, 0.02, 0.10), -45);
      exitX(c2, win(p, 0.06, 0.14), -45);
      exitX(c3, win(p, 0.10, 0.18), -45);
      exitX(right, win(p, 0.04, 0.16), 45);

      var m = win(p, 0.04, 0.20);
      if (mark) {
        mark.style.transform = "translate3d(0," + (m * 115).toFixed(2) + "%,0) scale(" + lerp(1, 0.96, m).toFixed(4) + ")";
        mark.style.opacity = String(1 - m);
        mark.style.visibility = 1 - m < 0.02 ? "hidden" : "visible";
      }
      if (hint) hint.style.opacity = String(1 - win(p, 0, 0.04));

      // Rótulo del centro operativo mientras la cámara orbita el depósito.
      if (caption) {
        var cin = win(p, 0.30, 0.38), cout = win(p, 0.60, 0.67);
        var o = clamp01(cin - cout);
        caption.style.opacity = String(o);
        caption.style.visibility = o < 0.02 ? "hidden" : "visible";
        caption.style.transform = "translate3d(0," + ((1 - cin) * 28 - cout * 28).toFixed(2) + "px,0)";
      }
    }

    var st = ScrollTrigger.create({
      trigger: track, start: "top top", end: "bottom bottom",
      onUpdate: function (self) { apply(self.progress); },
      onRefresh: function (self) { size(); apply(self.progress); }
    });
    size();
    apply(st.progress);
    window.addEventListener("resize", size);
  }

  /* ==================================================================
     B · S-System: polyline medida en runtime + numeral sobre offset-path
     ================================================================== */
  function initCaps() {
    var section = $(".m-caps");
    if (!section) return;
    var box = $(".m-caps-box", section);
    var poly = $(".m-caps-svg polyline", section);
    var numeral = $(".m-caps-numeral", section);
    var rows = $$(".m-cap", section);
    var INDENTS = rows.map(function (r) { return parseFloat(r.getAttribute("data-indent") || "0"); });
    var DROP = 34;
    var tops = [], total = 0, reached = -1;

    function build() {
      var W = box.clientWidth, H = box.clientHeight;
      var bt = box.getBoundingClientRect().top;
      tops = rows.map(function (r) { return r.getBoundingClientRect().top - bt; });
      var rail = parseFloat(getComputedStyle(box).paddingLeft) || 0;
      var inner = W - rail;
      // la línea corre por el riel, a la izquierda de cada fila
      var xs = INDENTS.map(function (pct) { return rail * 0.5 + (pct / 100) * inner; });
      var pts = [[xs[0], 0]];
      for (var i = 1; i < xs.length; i++) {
        var y = tops[i] + DROP;
        pts.push([xs[i - 1], y], [xs[i], y]);
      }
      pts.push([xs[xs.length - 1], H]);
      poly.setAttribute("points", pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "));
      total = poly.getTotalLength();
      poly.style.strokeDasharray = String(total);
      var d = "M" + pts.map(function (p) { return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" L");
      numeral.style.offsetPath = "path('" + d + "')";
    }

    function apply(p) {
      poly.style.strokeDashoffset = String(total * (1 - p));
      numeral.style.offsetDistance = (p * 100).toFixed(3) + "%";
      var pt = poly.getPointAtLength(total * p);
      var idx = 0;
      tops.forEach(function (t, i) { if (pt.y >= t + DROP - 1) idx = i; });
      if (idx !== reached) {
        reached = idx;
        numeral.textContent = String(idx + 1).padStart(2, "0");
        rows.forEach(function (r, i) { r.classList.toggle("on", i <= idx); });
      }
    }

    build();
    var st = ScrollTrigger.create({
      trigger: box, start: "top 70%", end: "bottom 70%",
      onUpdate: function (self) { apply(self.progress); },
      onRefresh: function (self) { build(); apply(self.progress); }
    });
    apply(st.progress);
    if (window.ResizeObserver) {
      new ResizeObserver(function () { build(); apply(st.progress); }).observe(box);
    }
  }

  /* ==================================================================
     C · Case study: stage pinneado 600vh, 4 métricas + handoff al amanecer
     ================================================================== */
  function initCase() {
    var track = $(".m-case");
    if (!track) return;
    var stage = $(".m-case-stage", track);
    var steps = $$(".m-case-flat .m-flat-metric").map(function (li) {
      return {
        num: li.getAttribute("data-num"),
        unit: li.getAttribute("data-unit") || "",
        html: li.querySelector(".m-flat-copy").innerHTML
      };
    });
    var N = steps.length;
    var XF = 0.04;
    var glows = $$(".m-case-glow", track);
    var glowWrap = $(".m-case-glows", track);
    var pitch = $(".m-case-pitch", track);
    var dawn = $(".m-case-dawn", track);
    var head = $(".m-case-head", track);
    var num = $(".m-case-num", track);
    var numInner = $(".m-case-num-inner", track);
    var left = $(".m-case-left", track);
    var swap = $(".m-case-swap", track);
    var stepLabel = $(".m-case-left .step", track);
    var right = $(".m-case-right", track);
    var idxEls = $$(".m-case-right span", track);
    var foot = $(".m-case-foot", track);
    var bars = $$(".m-case-bar b", track);
    var house = $(".m-case-house", track);
    var houseInner = $(".m-case-house .container", track);
    var houseH2 = $(".m-case-house h2", track);
    var houseParts = JSON.parse(houseH2.getAttribute("data-parts"));
    var active = -1, houseIn = null;

    function caseOpacity(i, d) {
      var a = i / N, b = (i + 1) / N;
      var fin = i === 0 ? 1 : win(d, a - XF, a + XF);
      var fout = i === N - 1 ? 0 : win(d, b - XF, b + XF);
      return clamp01(fin - fout);
    }

    function setActive(i) {
      active = i;
      var s = steps[i];
      cascade(numInner, [{ t: s.num }, { t: s.unit, cls: "unit" }], { stagger: 30 });
      swapBlock(swap, s.html);
      if (stepLabel) stepLabel.textContent = "Métrica " + String(i + 1).padStart(2, "0") + " / " + String(N).padStart(2, "0");
      idxEls.forEach(function (el, j) { el.classList.toggle("on", j === i); });
    }

    function apply(p) {
      var d = win(p, 0, 0.6);
      glows.forEach(function (g, i) { g.style.opacity = String(caseOpacity(i, d)); });
      var idx = Math.min(N - 1, Math.max(0, Math.floor(d * N)));
      if (idx !== active) setActive(idx);
      bars.forEach(function (b, i) { b.style.transform = "scaleX(" + clamp01(d * N - i).toFixed(4) + ")"; });

      // número central: leve zoom durante los pasos, se hunde en el handoff
      var exit = win(p, 0.60, 0.68);
      if (num) {
        num.style.transform = "translate(-50%,-50%) translate3d(0," + lerp(0, 30, exit).toFixed(3) + "vh,0) scale(" + lerp(1, 1.06, d).toFixed(4) + ")";
        hide(num, exit);
      }

      // ---- handoff ----
      var dark = win(p, 0.58, 0.66);
      if (glowWrap) glowWrap.style.opacity = String(1 - dark);
      if (pitch) pitch.style.opacity = String(dark);

      var rail = win(p, 0.60, 0.66);
      if (head) { head.style.transform = "translate3d(0," + lerp(0, -40, exit).toFixed(3) + "vh,0)"; hide(head, exit); }
      if (left) { left.style.transform = "translateY(-50%) translate3d(" + lerp(0, -45, exit).toFixed(3) + "vw,0,0)"; hide(left, rail); }
      if (right) { right.style.transform = "translateY(-50%) translate3d(" + lerp(0, 30, exit).toFixed(3) + "vw,0,0)"; hide(right, rail); }
      if (foot) { foot.style.transform = "translate3d(0," + lerp(0, 30, exit).toFixed(3) + "vh,0)"; hide(foot, exit); }

      var up = win(p, 0.66, 0.80);
      if (dawn) dawn.style.transform = "translate3d(0," + lerp(100, 0, up).toFixed(3) + "%,0)";
      stage.setAttribute("data-nav", p > 0.74 ? "light" : "dark");

      var enter = p >= 0.8;
      if (enter !== houseIn) {
        houseIn = enter;
        house.classList.toggle("in", enter);
        house.setAttribute("aria-hidden", enter ? "false" : "true");
        if (enter) { houseH2.innerHTML = ""; houseH2.appendChild(buildWord(houseParts, { stagger: 22, delay: 100 })); }
      }
      if (houseInner) houseInner.style.transform = "translate3d(0," + lerp(40, 0, win(p, 0.8, 1)).toFixed(2) + "px,0)";
      if (window.navThemeCheck) window.navThemeCheck();
    }

    var st = ScrollTrigger.create({
      trigger: track, start: "top top", end: "bottom bottom",
      onUpdate: function (self) { apply(self.progress); },
      onRefresh: function (self) { apply(self.progress); }
    });
    apply(st.progress);
  }

  /* ==================================================================
     D · Footer destapado: wordmark medido borde a borde + lift contra el scroll
     ================================================================== */
  function initFooter() {
    var mark = $(".m-footer-mark");
    var lift = $(".m-footer-lift");
    if (!mark) return;
    function fit() {
      var target = root.clientWidth;
      var size = 100;
      mark.style.fontSize = size + "px";
      for (var i = 0; i < 8; i++) {
        var w = mark.getBoundingClientRect().width;
        if (!w) break;
        var ratio = target / w;
        if (Math.abs(1 - ratio) < 0.005) break;
        size *= ratio;
        mark.style.fontSize = size + "px";
      }
      mark.style.opacity = "1";
    }
    fit();
    window.addEventListener("resize", fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

    if (REDUCED || STATIC || !lift) return;
    function onScroll() {
      var remaining = root.scrollHeight - window.innerHeight - window.scrollY;
      var t = clamp01(1 - remaining / window.innerHeight);
      lift.style.transform = "translate3d(0," + ((1 - t) * 60).toFixed(2) + "px,0)";
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------------- Arranque ---------------- */
  function start() {
    initNavTheme();
    initFooter();
    if (STATIC || !window.gsap || !window.ScrollTrigger) return;

    gsap.registerPlugin(ScrollTrigger);

    if (window.Lenis) {
      var lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
      gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      gsap.ticker.lagSmoothing(0);
      lenis.on("scroll", ScrollTrigger.update);
      window.__lenis = lenis;
      // anclas internas con el mismo suavizado
      document.addEventListener("click", function (e) {
        var a = e.target.closest && e.target.closest('a[href^="#"]');
        if (!a) return;
        var id = a.getAttribute("href");
        var el = id.length > 1 && document.querySelector(id);
        if (!el) return;
        e.preventDefault();
        lenis.scrollTo(el, { offset: -72 });
      });
    }

    initHero();
    initCaps();
    initCase();

    window.addEventListener("load", function () { ScrollTrigger.refresh(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
