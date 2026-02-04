// src/mount.js
import Globe from "globe.gl";
import * as THREE from "three";

console.log("SIGN GLOBE BUILD:", "2026-02-03 teardrop-plane-spiderfy-anchored-FULL-v1");

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

  // Robust numeric parsing:
  // - "47,6062" -> 47.6062 (decimal comma)
  // - "1,234.5" -> 1234.5 (thousands comma)
  const toNum = (v) => {
    let s = String(v ?? "").trim();
    if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
    else s = s.replace(/,/g, "");
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

/** =========================
 *  Panel (Story mode + Cluster chooser mode)
 *  ========================= */

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makePanel(container) {
  const panel = document.createElement("div");
  panel.dataset.sgPanel = "1";

  panel.style.cssText = `
    position:absolute;
    right:16px;
    top:16px;
    width:min(440px, 92%);
    max-height:82vh;
    background:#fff;
    border-radius:12px;
    box-shadow:0 8px 24px rgba(0,0,0,.18);
    padding:14px;
    display:none;
    z-index:999999;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    pointer-events:auto;
    overflow:hidden;
  `;

  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
      <div>
        <div id="sg-title" style="font-weight:800;font-size:16px;"></div>
        <div id="sg-meta" style="opacity:.7;font-size:13px; margin-top:2px;"></div>
      </div>
      <button id="sg-close" style="cursor:pointer; font-size:18px; line-height:1; border:0; background:transparent;">×</button>
    </div>

    <!-- Cluster chooser -->
    <div id="sg-cluster" style="display:none; margin-top:10px;">
      <div style="font-weight:700; margin-bottom:8px;">Choose a story</div>
      <div id="sg-list"
        style="
          max-height:52vh;
          overflow:auto;
          border:1px solid rgba(0,0,0,0.08);
          border-radius:10px;
        "
      ></div>
      <div style="margin-top:10px; opacity:.7; font-size:12px;">
        Tip: click a pin in the ring or select from this list.
      </div>
    </div>

    <!-- Story -->
    <div id="sg-story" style="display:none;">
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
        <a id="sg-src" href="#" target="_blank" rel="noopener" style="display:none;">Read more</a>
      </div>
    </div>
  `;

  container.appendChild(panel);

  const titleEl = panel.querySelector("#sg-title");
  const metaEl = panel.querySelector("#sg-meta");

  const clusterWrap = panel.querySelector("#sg-cluster");
  const listEl = panel.querySelector("#sg-list");

  const storyWrap = panel.querySelector("#sg-story");
  const bodyEl = panel.querySelector("#sg-body");
  const imgWrap = panel.querySelector("#sg-image");
  const imgEl = panel.querySelector("#sg-img");
  const srcEl = panel.querySelector("#sg-src");

  panel.querySelector("#sg-close").onclick = () => (panel.style.display = "none");
  const show = () => (panel.style.display = "block");

  function showStory(story) {
    titleEl.textContent = story.title || "";
    metaEl.textContent = story.country || "";

    clusterWrap.style.display = "none";
    storyWrap.style.display = "block";

    if (story.image_url) {
      imgEl.src = story.image_url;
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

    show();
  }

  function showCluster({ title, meta, items, onPick, onHover }) {
    titleEl.textContent = title || "";
    metaEl.textContent = meta || "";

    storyWrap.style.display = "none";
    clusterWrap.style.display = "block";

    listEl.innerHTML = "";
    items.forEach((s) => {
      const row = document.createElement("button");
      row.type = "button";
      row.style.cssText = `
        width:100%;
        text-align:left;
        padding:10px 12px;
        border:0;
        border-bottom:1px solid rgba(0,0,0,0.06);
        background:#fff;
        cursor:pointer;
        display:flex;
        flex-direction:column;
        gap:3px;
      `;
      row.innerHTML = `
        <div style="font-weight:700; font-size:14px; line-height:1.25;">
          ${escapeHtml(s.title || "(Untitled story)")}
        </div>
        <div style="opacity:.75; font-size:12px;">
          ${escapeHtml(s.country || "")}
        </div>
      `;
      row.onmouseenter = () => onHover?.(s, true);
      row.onmouseleave = () => onHover?.(s, false);
      row.onclick = () => onPick?.(s);
      listEl.appendChild(row);
    });

    show();
  }

  return { showStory, showCluster };
}

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

    overlays.forEach((el) => (el.style.pointerEvents = "none"));

    const panel = container.querySelector('[data-sg-panel="1"]');
    if (panel) panel.style.pointerEvents = "auto";

    if (tries < 40) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** =========================
 *  Pin texture (teardrop) — FULL SOLID INTERIOR
 *  Key trick: stroke first, then clip-fill so outline never "eats" the green.
 *  Also disable mipmaps to avoid weird edge blending.
 *  ========================= */

const SIGN_GREEN = "#81BC41";
const SIGN_OUTLINE = "#2d6a1f";
function makePinTexture({ w = 256, h = 384 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h * 0.33;
  const r  = w * 0.22;
  const tipY = h * 0.94;

  const path = new Path2D();
  path.arc(cx, cy, r, 0, Math.PI * 2);
  path.moveTo(cx - r * 0.95, cy + r * 0.10);
  path.bezierCurveTo(
    cx - r * 1.35, cy + r * 1.05,
    cx - r * 0.55, cy + r * 2.60,
    cx, tipY
  );
  path.bezierCurveTo(
    cx + r * 0.55, cy + r * 2.60,
    cx + r * 1.35, cy + r * 1.05,
    cx + r * 0.95, cy + r * 0.10
  );
  path.closePath();

  // 1) Fill solid green
  ctx.fillStyle = SIGN_GREEN;
  ctx.fill(path);

  // 2) Stroke outline
  const lw = w * 0.05;
  ctx.lineWidth = lw;
  ctx.strokeStyle = SIGN_OUTLINE;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(path);

  // ✅ 3) COVER the inside part of the head outline (removes the “crescent”)
  ctx.fillStyle = SIGN_GREEN;
  ctx.beginPath();
  ctx.arc(cx, cy, r - lw * 0.65, 0, Math.PI * 2);
  ctx.fill();

  // 4) White dot last
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}


// DEV: no cache to guarantee updates show. (You can cache later.)
function getPinTexture() {
  return makePinTexture();
}

/** =========================
 *  Teardrop plane pin (NOT a sprite)
 *  - tip anchored at group origin
 *  - head up, tip down (we orient group to globe normal)
 *  ========================= */

function makePinObject({ scale = 6.0 } = {}) {
  const group = new THREE.Group();

  const mat = new THREE.MeshBasicMaterial({
    map: getPinTexture(),
  
    // ✅ key: do NOT blend semi-transparent pixels with the globe
    transparent: false,
  
    // ✅ punch out the background of the texture
    alphaTest: 0.25,
  
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  

  const w = scale;
  const h = scale * 1.42;

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);

  // Tip anchored at group origin
  plane.position.y = h * 0.5;

  // Small lift away from globe surface (prevents intersection)
  plane.position.z = 0.00;

  plane.frustumCulled = false;
  group.add(plane);

  // Small invisible hit target near tip
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(scale * 0.14, 10, 10),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })
  );
  hit.position.set(0, scale * 0.18, 0);
  group.add(hit);

  group.userData.plane = plane;
  group.userData.baseScale = scale;

  return group;
}

function setHover(group, on) {
  const plane = group?.userData?.plane;
  if (!plane) return;
  const k = on ? 1.06 : 1.0;
  plane.scale.set(k, k, 1);
}

function bounce(group) {
  const plane = group?.userData?.plane;
  if (!plane) return;

  const start = performance.now();
  const D = 420;

  function frame(t) {
    const p = Math.min(1, (t - start) / D);
    const s = Math.sin(p * Math.PI) * (1 - p);
    const k = 1 + s * 0.22;
    plane.scale.set(k, k, 1);
    if (p < 1) requestAnimationFrame(frame);
    else plane.scale.set(1, 1, 1);
  }
  requestAnimationFrame(frame);
}

/** =========================
 *  Per-frame anchoring (VERTICAL PIN)
 *  - Round head UP (away from center)
 *  - Tip DOWN (toward center)
 *  - No camera billboarding (keeps consistent "map pin" look)
 *  ========================= */

function startPinAnchoring(globe, getStoriesRef) {
  let raf = 0;
  const Y = new THREE.Vector3(0, 1, 0);

  const tick = () => {
    const stories = getStoriesRef();
    for (const d of stories) {
      const obj = d.__obj;
      if (!obj) continue;

      // obj.position is in globe/world coords, globe centered at origin
      const pos = obj.position;
      const lenSq = pos.x * pos.x + pos.y * pos.y + pos.z * pos.z;
      if (lenSq < 1e-10) continue;

      // outward normal (head up)
      const n = pos.clone().normalize();

      // rotate group so local +Y aligns with normal
      obj.quaternion.setFromUnitVectors(Y, n);
    }

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** =========================
 *  Spiderfy (stories-only)
 *  ========================= */

const SPIDER_RADIUS_DEG = 0.18;
const SPIDER_STEP_DEG_BASE = 0.07;

function approxDistDeg(aLat, aLng, bLat, bLng) {
  const lonScale = Math.max(0.25, Math.cos((aLat * Math.PI) / 180));
  const dLat = aLat - bLat;
  const dLng = (aLng - bLng) * lonScale;
  return Math.hypot(dLat, dLng);
}

function spiderStepDeg(globe) {
  const alt = globe.pointOfView()?.altitude ?? 1.2;
  return SPIDER_STEP_DEG_BASE * (0.8 + alt / 1.4);
}

function collapseSpider(allStories) {
  return allStories.map((s) => ({
    ...s,
    __lat: s.pin_lat,
    __lng: s.pin_lon,
    __spider: false,
    __spiderKey: null,
  }));
}

function spiderfyAround(globe, clicked, allStories) {
  const baseLat = clicked.pin_lat;
  const baseLng = clicked.pin_lon;

  const group = allStories
    .map((s) => ({ s, d: approxDistDeg(baseLat, baseLng, s.pin_lat, s.pin_lon) }))
    .filter((x) => x.d < SPIDER_RADIUS_DEG)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.s);

  if (group.length <= 1) return { didSpider: false, stories: allStories, group: [] };

  const golden = Math.PI * (3 - Math.sqrt(5));
  const step = spiderStepDeg(globe);
  const lonScale = Math.max(0.25, Math.cos((baseLat * Math.PI) / 180));
  const ids = new Set(group.map((s) => s.id));

  const next = allStories.map((s) => {
    if (!ids.has(s.id)) {
      return { ...s, __lat: s.pin_lat, __lng: s.pin_lon, __spider: false, __spiderKey: null };
    }
    const i = group.findIndex((g) => g.id === s.id);
    const r = step * Math.sqrt(i + 0.2);
    const a = i * golden;

    return {
      ...s,
      __lat: baseLat + r * Math.cos(a),
      __lng: baseLng + (r * Math.sin(a)) / lonScale,
      __spider: true,
      __spiderKey: "1",
    };
  });

  return { didSpider: true, stories: next, group };
}

/** =========================
 *  Mount
 *  ========================= */

export async function mountSignGlobe({ containerId = "sign-globe", height = 650 } = {}) {
  console.log("MOUNT RUNNING ✅");

  const container = document.getElementById(containerId);
  if (!container) throw new Error(`Missing #${containerId}`);

  container.style.position = "relative";
  container.style.height = typeof height === "number" ? `${height}px` : height;
  container.style.width = "100%";
  container.style.touchAction = "none";
  container.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });

  const globe = Globe()(container)
    .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg")
    .backgroundColor("rgba(0,0,0,0)");

  if (typeof globe.enablePointerInteraction === "function") globe.enablePointerInteraction(true);

  // Controls
  const controls = globe.controls();
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Always rotate (a bit faster)
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.2;

  // Lights
  globe.scene().add(new THREE.AmbientLight(0xffffff, 0.95));
  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(1, 1, 1);
  globe.scene().add(dir);

  // UI
  const panel = makePanel(container);
  disableBlockingOverlays(container);

  // Data
  const storiesRaw = await loadStoriesFromGoogleSheet();
  console.log("STORIES LOADED ✅", storiesRaw.length, storiesRaw[0]);

  // Mutable stories array includes display coords
  let stories = storiesRaw.map((s) => ({
    ...s,
    __lat: s.pin_lat,
    __lng: s.pin_lon,
    __spider: false,
    __spiderKey: null,
  }));

  // Pin size
  const PIN_SCALE = 6.0;

  // Hover tracking
  let lastHovered = null;

  globe
    .objectsData(stories)
    .objectLat((d) => d.__lat)
    .objectLng((d) => d.__lng)
    // ✅ tiny altitude: avoids parallax "floating"
    .objectAltitude(0.002)
    .objectThreeObject((d) => {
      const obj = makePinObject({ scale: PIN_SCALE });
      d.__obj = obj;
      return obj;
    })
    .onObjectHover((d) => {
      if (lastHovered && lastHovered !== d) setHover(lastHovered.__obj, false);

      if (d && d.__obj) {
        setHover(d.__obj, true);
        lastHovered = d;
      } else {
        lastHovered = null;
      }
    })
    .onObjectClick((d) => {
      if (!d) return;

      // If not spiderfied yet, attempt spiderfy around clicked point
      if (!d.__spider) {
        const { didSpider, stories: nextStories, group } = spiderfyAround(globe, d, stories);
        if (didSpider) {
          stories = nextStories;
          globe.objectsData(stories);

          panel.showCluster({
            title: `${group.length} stories here`,
            meta: d.country || "",
            items: group,
            onPick: (story) => {
              const live = stories.find((x) => x.id === story.id) || story;
              panel.showStory(live);
              if (live.__obj) bounce(live.__obj);
            },
            onHover: (story, on) => {
              const live = stories.find((x) => x.id === story.id);
              if (live?.__obj) setHover(live.__obj, on);
            },
          });

          return;
        }
      }

      // Otherwise open directly
      panel.showStory(d);
      if (d.__obj) bounce(d.__obj);
    });

  // Start per-frame anchoring: head up, tip down
  const stopAnchoring = startPinAnchoring(globe, () => stories);

  // Collapse spider on background click
  const collapse = () => {
    const anySpider = stories.some((s) => s.__spider);
    if (!anySpider) return;
    stories = collapseSpider(stories);
    globe.objectsData(stories);
  };

  if (typeof globe.onGlobeClick === "function") {
    globe.onGlobeClick(() => collapse());
  } else {
    container.addEventListener("pointerdown", () => {
      if (!lastHovered) collapse();
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") collapse();
  });

  console.log("Globe mounted. Stories:", stories.length);

  globe.__signCleanup = () => {
    try {
      stopAnchoring?.();
    } catch {}
  };

  return globe;
}
