import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PARAM_DEFS, TEMPLATES } from "./params.js";
import { STR } from "./i18n.js";

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ------------------------------------------------------------------ state */
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const state = {
  lang: (navigator.language || "en").toLowerCase().startsWith("ja") ? "ja" : "en",
  sym: true,
  active: 0,                       // which finger the sliders edit when not symmetrical
  tpl: "flat",                     // highlighted template, or null once edited by hand
  fingers: [{ ...TEMPLATES.flat }, { ...TEMPLATES.flat }],
};
if (store.get("fm.lang")) state.lang = store.get("fm.lang");
const t = (k) => STR[state.lang][k] ?? k;
const slot = () => (state.sym ? 0 : state.active);
const cur = () => state.fingers[slot()];
let lastStats = null;

/* ------------------------------------------------------------ CAD worker */
const worker = new Worker(new URL("./cad-worker.js", import.meta.url), { type: "module" });
let engineReady = false, engineFailed = false, rpcId = 0;
const pending = new Map();

worker.onmessage = ({ data }) => {
  if (data.type === "ready") { engineReady = true; pump(); return; }
  if (data.type === "fatal") { engineFailed = true; setStatus("fatal", "err"); return; }
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  data.ok ? p.resolve(data) : p.reject(new Error(data.error));
};
worker.onerror = () => { engineFailed = true; setStatus("fatal", "err"); };

const call = (msg) => new Promise((resolve, reject) => {
  const id = ++rpcId;
  pending.set(id, { resolve, reject });
  worker.postMessage({ ...msg, id });
});

/* ------------------------------------------------------------ status bar */
function setStatus(key, cls = "") {
  const s = $("#status");
  s.textContent = t("st_" + key);
  s.className = "status " + cls;
  s.dataset.key = key;
}

/* -------------------------------------------------------- build pipeline */
let inflight = false, dirty = false, timer = 0;
function scheduleBuild(delay = 90) {
  clearTimeout(timer);
  timer = setTimeout(pump, delay);
}
async function pump() {
  if (!engineReady || engineFailed) return;
  if (inflight) { dirty = true; return; }
  inflight = true; dirty = false;
  setStatus("building", "busy");
  try {
    const res = await call({ cmd: "build", slot: slot(), params: { ...cur() } });
    setMesh(res.mesh);
    lastStats = res.stats;
    renderSummary();
    if (!dirty) setStatus("ready", "ok");
  } catch (err) {
    console.error(err);
    setStatus("error", "err");
  } finally {
    inflight = false;
    if (dirty) pump();
  }
}

/* --------------------------------------------------------------- 3D view */
const canvas = $("#cv");
const wrap = $("#canvasWrap");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);
camera.up.set(0, 0, 1);                       // Z is the finger's length axis
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
controls.addEventListener("change", requestRender);
controls.addEventListener("start", () => $("#viewSeg .on")?.classList.remove("on"));

scene.add(new THREE.HemisphereLight(0xffffff, 0x203035, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(1, -1, 2); scene.add(key);
const fill = new THREE.DirectionalLight(0xbfefff, 0.6); fill.position.set(-1.5, 1, 0.5); scene.add(fill);

const grid = new THREE.GridHelper(240, 24, 0x2c474d, 0x1a2b30);
grid.rotation.x = Math.PI / 2;                // lay the grid in the XY plane
scene.add(grid);

const material = new THREE.MeshStandardMaterial({ color: 0x35d6d2, roughness: 0.62, metalness: 0.04 });
const edgeMat = new THREE.LineBasicMaterial({ color: 0x06282a, transparent: true, opacity: 0.75 });
let mesh = null, edges = null, hasFit = false;
const center = new THREE.Vector3();
let radius = 50;

function setMesh(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(m.normal, 3));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  if (mesh) { mesh.geometry.dispose(); edges.geometry.dispose(); scene.remove(mesh, edges); }
  mesh = new THREE.Mesh(g, material);
  edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 32), edgeMat);
  scene.add(mesh, edges);
  g.boundingBox.getCenter(center);
  radius = g.boundingSphere.radius;
  if (!hasFit) { hasFit = true; goView("iso", false); }
  requestRender();
}

const VIEWS = {
  iso:   [0.85, -1.15, 0.7],
  front: [1, 0, 0.06],          // looking at the gripping face
  side:  [0, -1, 0.06],         // profile: taper and tip lip
  top:   [0.0, -0.03, 1],       // looking down the finger at its tip
};
let tween = null;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function goView(name, animate = true) {
  const dir = new THREE.Vector3(...VIEWS[name]).normalize();
  const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.08;
  const toPos = center.clone().addScaledVector(dir, dist);
  if (!animate || reduceMotion) {
    camera.position.copy(toPos); controls.target.copy(center); controls.update(); requestRender();
    return;
  }
  tween = {
    t0: performance.now(), dur: 320,
    fromPos: camera.position.clone(), toPos,
    fromTgt: controls.target.clone(), toTgt: center.clone(),
  };
  requestRender();
}

let rafPending = false;
function requestRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    if (tween) {
      const k = Math.min(1, (performance.now() - tween.t0) / tween.dur);
      const e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
      controls.target.lerpVectors(tween.fromTgt, tween.toTgt, e);
      controls.update();
      if (k >= 1) tween = null; else requestRender();
    }
    renderer.render(scene, camera);
  });
}

new ResizeObserver(() => {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  requestRender();
}).observe(wrap);

canvas.addEventListener("dblclick", () => goView("iso"));
$("#viewSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-v]");
  if (!b) return;
  $("#viewSeg .on")?.classList.remove("on");
  b.classList.add("on");
  goView(b.dataset.v);
});

/* ---------------------------------------------------------- controls UI */
const decimals = (step) => (String(step).split(".")[1] || "").length;
const fmt = (v, step) => Number(v).toFixed(decimals(step));

function buildTemplates() {
  const host = $("#templates");
  host.innerHTML = "";
  for (const id of Object.keys(TEMPLATES)) {
    const b = el("button", "tpl" + (state.tpl === id ? " on" : ""));
    b.type = "button"; b.dataset.id = id;
    b.append(profileIcon(TEMPLATES[id]), el("span", null, t("tpl_" + id)));
    b.addEventListener("click", () => applyTemplate(id));
    host.append(b);
  }
  $("#templateBlurb").textContent = state.tpl ? t("blurb_" + state.tpl) : "";
}

// A tiny side-view silhouette so each template is recognisable at a glance.
function profileIcon(p) {
  const s = 0.4, k = 2.4, ox = 20, base = 42;   // 0.4 px per mm along the length; thickness exaggerated 2.4x
  const pts = [[0, 0]];
  if (p.hook > 0) pts.push([0, p.length - p.hookLength], [p.hook, p.length - p.hookLength * 0.55], [p.hook, p.length]);
  else pts.push([0, p.length]);
  pts.push([-p.tipThickness, p.length], [-p.baseThickness, 0]);
  const d = pts.map(([x, z]) => `${(ox + x * s * k).toFixed(1)},${(base - z * s).toFixed(1)}`).join(" ");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 32 44"); svg.setAttribute("aria-hidden", "true");
  const poly = document.createElementNS(svg.namespaceURI, "polygon");
  poly.setAttribute("points", d);
  svg.append(poly);
  return svg;
}

function applyTemplate(id) {
  state.fingers[slot()] = { ...TEMPLATES[id] };
  if (state.sym) state.fingers[1] = { ...TEMPLATES[id] };
  state.tpl = id;
  syncSliders();
  buildTemplates();
  scheduleBuild(0);
}

function buildSliders() {
  const host = $("#sliders");
  host.innerHTML = "";
  let group = null, sec = null;
  for (const d of PARAM_DEFS) {
    if (d.group !== group) {
      group = d.group;
      sec = el("section", "block");
      sec.append(el("h2", null, t("g_" + group)));
      host.append(sec);
    }
    const row = el("div", "row");
    const id = "p-" + d.key;
    const label = el("label", null, t("p_" + d.key)); label.htmlFor = id;
    const val = el("span", "val");
    const num = el("input"); num.type = "number"; num.id = id;
    num.min = d.min; num.max = d.max; num.step = d.step;
    val.append(num);
    if (d.unit) val.append(el("i", null, d.unit));
    const rng = el("input"); rng.type = "range";
    rng.min = d.min; rng.max = d.max; rng.step = d.step;
    rng.setAttribute("aria-label", t("p_" + d.key));

    const set = (v) => {
      v = Math.min(d.max, Math.max(d.min, Number(v)));
      if (!Number.isFinite(v)) return;
      cur()[d.key] = v;
      if (state.sym) state.fingers[1][d.key] = v;
      if (state.tpl) { state.tpl = null; buildTemplates(); }
      syncSliders();
      scheduleBuild();
    };
    rng.addEventListener("input", () => set(rng.value));
    num.addEventListener("change", () => set(num.value));
    row.append(label, val, rng);
    row.dataset.key = d.key;
    sec.append(row);
  }
  syncSliders();
}

function syncSliders() {
  const p = cur();
  for (const d of PARAM_DEFS) {
    const row = $(`#sliders .row[data-key="${d.key}"]`);
    if (!row) continue;
    const num = row.querySelector("input[type=number]");
    const rng = row.querySelector("input[type=range]");
    const v = p[d.key];
    if (document.activeElement !== num) num.value = fmt(v, d.step);
    rng.value = v;
    rng.style.setProperty("--pct", ((v - d.min) / (d.max - d.min)) * 100 + "%");
  }
}

function buildTabs() {
  const host = $("#fingerTabs");
  host.hidden = state.sym;
  host.innerHTML = "";
  ["finger_a", "finger_b"].forEach((k, i) => {
    const b = el("button", state.active === i ? "on" : "", t(k));
    b.type = "button";
    b.addEventListener("click", () => {
      state.active = i; state.tpl = null;
      buildTabs(); buildTemplates(); syncSliders(); renderExports(); scheduleBuild(0);
    });
    host.append(b);
  });
}

$("#symChk").addEventListener("change", (e) => {
  state.sym = e.target.checked;
  if (state.sym) { state.active = 0; state.fingers[1] = { ...state.fingers[0] }; }
  buildTabs(); syncSliders(); renderExports(); scheduleBuild(0);
});

/* ---------------------------------------------------------- summary panel */
function renderSummary() {
  const host = $("#summary"), warns = $("#warns");
  host.innerHTML = ""; warns.innerHTML = "";
  if (!lastStats) return;
  const [sx, sy, sz] = lastStats.size;                       // X = thickness, Y = width, Z = length
  const rows = [
    ["size", `${sy.toFixed(1)} × ${sx.toFixed(1)} × ${sz.toFixed(1)} mm`],
    ["volume", `${(lastStats.volume / 1000).toFixed(2)} cm³`],
    ["mass", `≈ ${((lastStats.volume / 1000) * 1.21).toFixed(1)} g`, t("mass_note")],
  ];
  for (const [k, v, note] of rows) {
    const dt = el("dt", null, t(k));
    const dd = el("dd", null, v);
    if (note) dd.append(el("small", null, note));
    host.append(dt, dd);
  }
  $("#dims").textContent = `${sy.toFixed(1)} × ${sx.toFixed(1)} × ${sz.toFixed(1)} mm`;

  const n = lastStats.notes, p = cur();
  if (n.radius < p.cornerRadius - 1e-6) warns.append(el("li", null, t("warn_radius")));
  if (!n.ribsFit) warns.append(el("li", null, t("warn_ribs")));
  if (!n.holesFit) warns.append(el("li", null, t("warn_holes")));
}

/* ---------------------------------------------------------------- export */
const MIME = { step: "model/step", stl: "model/stl" };

function fileName(slotIdx, format) {
  const tag = state.sym ? "" : slotIdx ? "-B" : "-A";
  return `finger-mod${tag}.${format}`;
}

function renderExports() {
  const host = $("#exports");
  host.innerHTML = "";
  const slots = state.sym ? [0] : [0, 1];
  for (const s of slots) {
    const row = el("div", "exrow");
    const title = state.sym
      ? `${t("export_finger")} (${t("print_twice")})`
      : t(s ? "finger_b" : "finger_a");
    row.append(el("div", "exname", title));
    const btns = el("div", "exbtns");
    for (const format of ["step", "stl"]) {
      const b = el("button", "dl-btn"); b.type = "button";
      b.append(el("b", null, format.toUpperCase()), el("small", null, fileName(s, format)));
      b.addEventListener("click", () => doExport(s, format, b));
      btns.append(b);
    }
    row.append(btns);
    host.append(row);
  }
}

async function doExport(slotIdx, format, btn) {
  if (!engineReady) return;
  btn.disabled = true; btn.classList.add("busy");
  try {
    const res = await call({ cmd: "export", format, slot: slotIdx, params: { ...state.fingers[slotIdx] } });
    const url = URL.createObjectURL(new Blob([res.data], { type: MIME[format] }));
    const a = el("a"); a.href = url; a.download = fileName(slotIdx, format);
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    console.error(err);
    setStatus("error", "err");
  } finally {
    btn.disabled = false; btn.classList.remove("busy");
  }
}

/* -------------------------------------------------------------- language */
function applyLang() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-t]").forEach((n) => { n.textContent = t(n.dataset.t); });
  document.querySelectorAll("#langSeg button").forEach((b) => b.classList.toggle("on", b.dataset.lang === state.lang));
  buildTemplates(); buildSliders(); buildTabs(); renderExports(); renderSummary();
  const k = $("#status").dataset.key;
  if (k) setStatus(k, $("#status").className.replace("status", "").trim());
}
$("#langSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-lang]");
  if (!b) return;
  state.lang = b.dataset.lang; store.set("fm.lang", state.lang);
  applyLang();
});

applyLang();
setStatus("loading", "busy");
