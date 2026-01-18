// src/mount.js
import Globe from "globe.gl";
import * as THREE from "three";

console.log("SIGN GLOBE BUILD:", "2026-01-21 pin-3d-green-v1");

/**
 * Reads your Google Sheet (published to web).
 * Expected headers (case-insensitive):
 * id, pin_lat, pin_lon, pin_label, title, country, story_html, image_url, source_url
 */
async function loadStoriesFromGoogleSheet() {
  const SHEET_ID = "1poB9Dj7m8dFoiVCtjd9BSzp1dqNVTclAakET4ARwVGE";
  const SHEET_NAME = "Stories";

  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:json` +
    `&sheet=${encodeURIComponent(SHEET_NAME)}` +
    `&headers=1` +
    `&tq=${encodeURIComponent("select *")}` +
    `&v=${Date.now()}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load sheet: ${res.status}`);

  const text = await res.text();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Could not parse Google Sheet response (no JSON object found).");
  }

  const json = JSON.parse(text.slice(start, end + 1));

  const colsRaw = (json.table.cols || []).map((c) => (c.label ?? ""));
  const cols = colsRaw.map((s) => s.trim().toLowerCase());
  const rows = json.table.rows || [];

  const raw = rows.map((r) => {
    const obj = {};
    (r.c || []).forEach((cell, i) => {
      obj[cols[i]] = cell ? cell.v : null;
    });
    return obj;
  });

  const get = (obj, ...keys) => {
    for (const k of keys) {
      const v = obj[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return null;
  };

  const toNum = (v) => {
    // tolerate "47,6062" / "47.6062 " / etc.
    const s = String(v ?? "").replace(/,/g, "").trim();
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  };

  const stories = raw
    .map((d) => {
      const latRaw = get(d, "pin_lat", "pin_lat (num)", "pin lat", "lat", "latitude");
      const lonRaw = get(d, "pin_lon", "pin_lon (num)", "pin lon", "lon", "lng", "longitude");

      return {
        id: String(get(d, "id") ?? ""),
        pin_lat: toNum(latRaw),
        pin_lon: toNum(lonRaw),
        pin_label: String(get(d, "pin_label", "pin label") ?? ""),
        title: String(get(d, "title") ?? ""),
        country: String(get(d, "country") ?? ""),
        story_html: String(get(d, "story_html", "story html") ?? ""),
        image_url: String(get(d, "image_url", "image url") ?? ""),
        source_url: String(get(d, "source_url", "source url") ?? ""),
      };
    })
    .filter((d) => Number.isFinite(d.pin_lat) && Number.isFinite(d.pin_lon));

  console.log("Sheet headers:", colsRaw);
  console.log("Rows fetched:", raw.length, "Valid pins:", stories.length);
  if (stories.length) console.log("Example story:", stories[0]);

  return stories;
}

function makePanel(container) {
  const panel = document.createElement("div");
  panel.dataset.sgPanel = "1";

  panel.style.cssText = `
  position:absolute;
  right:16px;
  top:16px;
  width:min(420px, 92%);
  max-height:80vh;            /* viewport-based */
  background:#fff;
  border-radius:12px;
  box-shadow:0 8px 24px rgba(0,0,0,.18);
  padding:14px;
  display:none;
  z-index:999999;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  pointer-events:auto;
  overflow:hidden;            /* prevent clipping */
`;


panel.innerHTML = `
  <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
    <div>
      <div id="sg-title" style="font-weight:700;font-size:16px;"></div>
      <div id="sg-meta" style="opacity:.7;font-size:13px; margin-top:2px;"></div>
    </div>
    <button id="sg-close" style="cursor:pointer;">×</button>
  </div>

  <div id="sg-image" style="margin-top:10px;display:none;">
    <img
      id="sg-img"
      style="width:100%;height:auto;max-height:28vh;object-fit:contain;border-radius:10px;display:block;background:#f3f3f3;"
    />
  </div>

  <div
    id="sg-body"
    style="
      margin-top:10px;
      line-height:1.45;
      max-height:35vh;
      overflow-y:auto;
      padding-right:6px;
    "
  ></div>

  <div style="margin-top:10px;">
    <a id="sg-src" href="#" target="_blank" rel="noopener" style="display:none;">Read on SIGN</a>
  </div>
`;



  container.appendChild(panel);

  const titleEl = panel.querySelector("#sg-title");
  const metaEl = panel.querySelector("#sg-meta");
  const bodyEl = panel.querySelector("#sg-body");
  const imgWrap = panel.querySelector("#sg-image");
  const imgEl = panel.querySelector("#sg-img");
  const srcEl = panel.querySelector("#sg-src");

  panel.querySelector("#sg-close").onclick = () => (panel.style.display = "none");

  return {
    open(story) {
      titleEl.textContent = story.title || "";
      metaEl.textContent = story.country || "";

      if (story.image_url) {
        imgEl.src = story.image_url;
        imgEl.onload = () => {
          console.log("IMAGE PIXELS:", imgEl.naturalWidth, "x", imgEl.naturalHeight);
        };        
        imgWrap.style.display = "block";
      } else {
        imgEl.src = "";
        imgWrap.style.display = "none";
      }

      bodyEl.innerHTML = story.story_html || "";

      if (story.source_url) {
        srcEl.href = story.source_url;
        srcEl.style.display = "inline";
      } else {
        srcEl.style.display = "none";
      }

      panel.style.display = "block";
    },
  };
}

// Prevent a blocking absolute overlay div from stealing drag events.
// Keep the panel clickable.
function disableBlockingOverlays(container) {
  let tries = 0;
  const tick = () => {
    tries++;

    const canvas = container.querySelector("canvas");
    if (canvas) {
      canvas.style.pointerEvents = "auto";
      canvas.style.touchAction = "none";
      canvas.style.cursor = "grab";
    }

    const overlays = Array.from(container.querySelectorAll("div")).filter((el) => {
      if (el.dataset.sgPanel === "1") return false;
      const cs = getComputedStyle(el);
      return cs.position === "absolute";
    });

    overlays.forEach((el) => {
      el.style.pointerEvents = "none";
    });

    const panel = container.querySelector('[data-sg-panel="1"]');
    if (panel) panel.style.pointerEvents = "auto";

    if (tries < 40) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Google-Maps style teardrop pin (canvas texture) -> THREE sprite
function makeGooglePinTexture({
  w = 512,
  h = 768,
  fill = "#d32f2f",
  stroke = "#b71c1c",
  strokeWidth = 34,
} = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h * 0.33;
  const r = w * 0.22;
  const tipY = h * 0.93;

  // shadow
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = w * 0.10;
  ctx.shadowOffsetY = h * 0.02;

  const path = new Path2D();

  // full circle head
  path.arc(cx, cy, r, 0, Math.PI * 2);

  // smooth shoulders -> point
  path.moveTo(cx - r * 0.95, cy + r * 0.10);
  path.bezierCurveTo(
    cx - r * 1.35, cy + r * 1.05,
    cx - r * 0.55, cy + r * 2.55,
    cx, tipY
  );
  path.bezierCurveTo(
    cx + r * 0.55, cy + r * 2.55,
    cx + r * 1.35, cy + r * 1.05,
    cx + r * 0.95, cy + r * 0.10
  );
  path.closePath();

  ctx.fillStyle = fill;
  ctx.fill(path);

  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = stroke;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(path);

  ctx.restore();

  // inner WHITE dot
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function makeGooglePinSprite() {
  const texture = makeGooglePinTexture();

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);

  // size on globe
  sprite.scale.set(7.0, 10.5, 1);

  // anchor at tip so point touches globe
  sprite.center.set(0.5, 0.98);

  return sprite;
}

// (Alternative) simple round red dot + white dot.
// If you prefer this style, swap to makeRedDotSprite() below.
function makeRedDotSprite() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  ctx.fillStyle = "#d32f2f";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 46, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 16, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(5.5, 5.5, 1);
  sprite.center.set(0.5, 0.5);
  return sprite;
}

const SIGN_GREEN = "#81BC41";

function make3DPin({ height = 0.35, radius = 0.06, headRadius = 0.10 } = {}) {
  const group = new THREE.Group();

  // shaft (peg)
  const shaftGeo = new THREE.CylinderGeometry(radius, radius, height, 12);
  const mat = new THREE.MeshStandardMaterial({
    color: SIGN_GREEN,
    roughness: 0.35,
    metalness: 0.05,
  });
  const shaft = new THREE.Mesh(shaftGeo, mat);
  shaft.position.y = height / 2; // base at y=0
  group.add(shaft);

  // head (slightly larger sphere)
  const headGeo = new THREE.SphereGeometry(headRadius, 16, 16);
  const head = new THREE.Mesh(headGeo, mat);
  head.position.y = height + headRadius * 0.75;
  group.add(head);

  // optional white center dot on the head (billboard-ish)
  const dotGeo = new THREE.CircleGeometry(headRadius * 0.45, 24);
  const dotMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.position.y = height + headRadius * 0.75;
  dot.position.z = headRadius * 0.98; // sit on front of sphere
  group.add(dot);

  // IMPORTANT: make sure each clone has its own material reference for raycasting
  group.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  group.position.y = -0.05; // pushes peg into the globe a bit
  return group;
}

function jitterDuplicatesByLatLng(stories, jitterDeg = 0.10) {
  const map = new Map();

  for (const s of stories) {
    const key = `${s.pin_lat.toFixed(5)},${s.pin_lon.toFixed(5)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }

  const out = [];

  for (const arr of map.values()) {
    if (arr.length === 1) {
      out.push(arr[0]);
      continue;
    }

    const baseLat = arr[0].pin_lat;
    const baseLon = arr[0].pin_lon;
    const n = arr.length;

    arr.forEach((s, i) => {
      const angle = (i / n) * Math.PI * 2;
      const dLat = jitterDeg * Math.cos(angle);
      const dLon =
        (jitterDeg * Math.sin(angle)) /
        Math.max(0.2, Math.cos((baseLat * Math.PI) / 180));

      out.push({
        ...s,
        pin_lat: baseLat + dLat,
        pin_lon: baseLon + dLon,
      });
    });
  }

  return out;
}

export async function mountSignGlobe({ containerId = "sign-globe", height = 650 } = {}) {
  const container = document.getElementById(containerId);
  if (!container) throw new Error(`Missing #${containerId}`);

  container.style.position = "relative";
  container.style.height = typeof height === "number" ? `${height}px` : height;
  container.style.width = "100%";
  container.style.touchAction = "none";

  // Prevent scroll/trackpad gestures from stealing drag when over the globe
  container.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });

  const globe = Globe()(container)
    .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg")
    .backgroundColor("rgba(0,0,0,0)");

  if (typeof globe.enablePointerInteraction === "function") {
    globe.enablePointerInteraction(true);
  }

  const controls = globe.controls();
  controls.enabled = true;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Optional auto-rotate (still draggable)
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.001;

  globe.scene().add(new THREE.AmbientLight(0xffffff, 0.9));
  globe.scene().add(new THREE.DirectionalLight(0xffffff, 0.9));

  const panel = makePanel(container);

  // drag fix
  disableBlockingOverlays(container);

  const storiesRaw = await loadStoriesFromGoogleSheet();
  const stories = jitterDuplicatesByLatLng(storiesRaw, 0.10);
  

  const pinTemplate = make3DPin();

  globe
    .objectsData(stories)
    .objectLat((d) => d.pin_lat)
    .objectLng((d) => d.pin_lon)
    .objectAltitude(0.01)
    .objectThreeObject(() => pinTemplate.clone(true))
    .onObjectClick((d) => {
      console.log("PIN CLICK", d.id);
      panel.open(d);
  });


  console.log("Globe mounted. Pins:", stories.length);
  return globe;
}
