// src/mount.js
import Globe from "globe.gl";
import * as THREE from "three";

console.log("SIGN GLOBE BUILD:", "2026-02-04 borders-nonblocking-v1");

async function loadSheetData() {
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
  if (start === -1 || end === -1) throw new Error("Could not parse Google Sheet response.");

  const json = JSON.parse(text.slice(start, end + 1));
  const colsRaw = (json.table.cols || []).map((c) => (c.label ?? ""));
  const cols = colsRaw.map((s) => s.trim().toLowerCase());
  const rows = json.table.rows || [];

  console.log("Sheet headers:", colsRaw);

  const raw = rows.map((r) => {
    const obj = {};
    (r.c || []).forEach((cell, i) => { obj[cols[i]] = cell ? cell.v : null; });
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
    let s = String(v ?? "").trim();
    if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
    else s = s.replace(/,/g, "");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  };

  const stories = [];
  const programs = [];

  raw.forEach((d) => {
    const latRaw = get(d, "pin_lat", "pin_lat (num)", "pin lat", "lat", "latitude");
    const lonRaw = get(d, "pin_lon", "pin_lon (num)", "pin lon", "lon", "lng", "longitude");
    const lat = toNum(latRaw);
    const lon = toNum(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const progLoc = get(d, "all_prog_locs", "all prog locs");
    const storyHtml = get(d, "story_html", "story html");

    // Row is a program location if all_prog_locs is filled in
    if (progLoc) {
      programs.push({
        pin_lat: lat,
        pin_lon: lon,
        name: String(progLoc),
        country: String(get(d, "country") ?? ""),
      });
    }

    // Row is a story if story_html is filled in
    if (storyHtml) {
      stories.push({
        id: String(get(d, "id") ?? ""),
        pin_lat: lat,
        pin_lon: lon,
        pin_label: String(get(d, "pin_label", "pin label") ?? ""),
        title: String(get(d, "title") ?? ""),
        country: String(get(d, "country") ?? ""),
        story_html: String(storyHtml),
        image_url: String(get(d, "image_url", "image url") ?? ""),
        source_url: String(get(d, "source_url", "source url") ?? ""),
      });
    }
  });

  console.log("Stories:", stories.length, "Programs:", programs.length);
  return { stories, programs };
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
    width:min(420px, 92%);
    max-height:calc(100% - 40px);   /* only limit if REALLY huge */
    overflow-y:auto;
    overflow-x:hidden;
    background:#fff;
    border-radius:12px;
    box-shadow:0 8px 24px rgba(0,0,0,.18);
    padding:18px;
    display:none;
    z-index:999999;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
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
        Tip: Select from this list.
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
 *  Program ring marker — flat circle on globe surface
 *  ========================= */

const SIGN_BLUE = "#2E86AB";

function makeProgramMarker({ scale = 5.0 } = {}) {
  const group = new THREE.Group();

  const geometry = new THREE.RingGeometry(scale * 0.55, scale * 0.85, 32);
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(SIGN_BLUE),
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -10,
    polygonOffsetUnits: -10,
  });

  const ring = new THREE.Mesh(geometry, material);
  ring.renderOrder = 998;
  ring.frustumCulled = false;
  group.add(ring);

  // Solid inner dot
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(scale * 0.3, 24),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(SIGN_BLUE),
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -10,
      polygonOffsetUnits: -10,
    })
  );
  dot.renderOrder = 998;
  dot.frustumCulled = false;
  group.add(dot);

  group.userData.baseScale = scale;
  return group;
}

/** =========================
 *  Pin texture (teardrop) — eliminates "unfilled crescent"
 *  Trick: after stroking, paint a slightly smaller GREEN head circle to cover the inner stroke,
 *  then paint the white dot.
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
  const r = w * 0.22;
  const tipY = h * 0.94;

  // Teardrop path
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

  // 1) Solid fill
  ctx.fillStyle = SIGN_GREEN;
  ctx.fill(path);

  // 2) Outline
  const lw = w * 0.05;
  ctx.lineWidth = lw;
  ctx.strokeStyle = SIGN_OUTLINE;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(path);

  // 3) Cover the inner half of the outline on the head (removes "crescent" look)
  ctx.fillStyle = SIGN_GREEN;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, r - lw * 0.70), 0, Math.PI * 2);
  ctx.fill();

  // 4) White dot
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

// DEV: no cache so you always see texture edits
function getPinTexture() {
  return makePinTexture();
}

/** =========================
 *  Teardrop plane pin (NOT sprite)
 *  - tip anchored at group origin
 *  - IMPORTANT: no plane local Z offsets (those can push into the globe after rotation)
 *  ========================= */
function makePinObject({ scale = 6.0 } = {}) {
  const group = new THREE.Group();

  const w = scale;
  const h = scale * 1.42;

  const mat = new THREE.MeshBasicMaterial({
    map: getPinTexture(),

    // Keep edges crisp but not see-through
    transparent: false,
    alphaTest: 0.25,

    // ✅ Pins win depth so borders can’t draw over them
    depthTest: true,
    depthWrite: true,

    side: THREE.DoubleSide,

    // ✅ Prevent z-fighting vs globe/borders
    polygonOffset: true,
    polygonOffsetFactor: -10,
    polygonOffsetUnits: -10,
  });

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);

  // tip anchored at group origin
  plane.position.y = h * 0.5;
  plane.position.z = 0;

  // ✅ Draw after polygons (secondary safeguard)
  plane.renderOrder = 999;
  plane.frustumCulled = false;

  group.add(plane);

  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(scale * 0.14, 10, 10),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })
  );
  hit.position.set(0, scale * 0.18, 0);
  hit.renderOrder = 0;
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
 *  Per-frame anchoring (vertical pin with fan-out)
 *  - head up (away from center)
 *  - tip down (toward center)
 *  - rotated around vertical axis for fan-out effect
 *  ========================= */

function startPinAnchoring(globe, getPinsRef) {
  let raf = 0;
  const Y = new THREE.Vector3(0, 1, 0);

  const tick = () => {
    const pins = getPinsRef();
    for (const d of pins) {
      const obj = d.__obj;
      if (!obj) continue;

      const pos = obj.position;
      const lenSq = pos.x * pos.x + pos.y * pos.y + pos.z * pos.z;
      if (lenSq < 1e-10) continue;

      // Point pin vertically (head away from globe center)
      const n = pos.clone().normalize();
      obj.quaternion.setFromUnitVectors(Y, n);
    }

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** =========================
 *  Pin Clustering
 *  Pre-clusters overlapping pins into single pins
 *  ========================= */

function approxDistDeg(aLat, aLng, bLat, bLng) {
  const lonScale = Math.max(0.25, Math.cos((aLat * Math.PI) / 180));
  const dLat = aLat - bLat;
  const dLng = (aLng - bLng) * lonScale;
  return Math.hypot(dLat, dLng);
}

/**
 * Positions pins with collision avoidance using iterative relaxation
 * Ensures minimum spacing between ALL pins
 */
function clusterStories(stories) {
  if (stories.length === 0) return [];

  const MIN_SPACING_DEG = 0.5; // Minimum spacing between pin centers
  const MAX_ITERATIONS = 50; // Max iterations for collision resolution

  // Start with original positions
  const pins = stories.map((story) => ({
    lat: story.pin_lat,
    lng: story.pin_lon,
    story: story,
  }));

  // Iteratively resolve overlaps
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let hadCollision = false;

    // Check all pairs for overlap
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        const dist = approxDistDeg(pins[i].lat, pins[i].lng, pins[j].lat, pins[j].lng);

        if (dist < MIN_SPACING_DEG && dist > 0.0001) {
          hadCollision = true;

          // Push pins apart
          const overlap = MIN_SPACING_DEG - dist;
          const pushDist = overlap / 2;

          // Calculate push direction
          const lonScale = Math.max(0.25, Math.cos((pins[i].lat * Math.PI) / 180));
          const dLat = pins[j].lat - pins[i].lat;
          const dLng = (pins[j].lng - pins[i].lng) * lonScale;
          const len = Math.sqrt(dLat * dLat + dLng * dLng);

          if (len > 0.0001) {
            const pushLat = (dLat / len) * pushDist;
            const pushLng = (dLng / len) * pushDist / lonScale;

            pins[i].lat -= pushLat;
            pins[i].lng -= pushLng;
            pins[j].lat += pushLat;
            pins[j].lng += pushLng;
          }
        }
      }
    }

    // If no collisions, we're done
    if (!hadCollision) {
      console.log(`Collision resolution converged in ${iter + 1} iterations`);
      break;
    }
  }

  return pins;
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

// =========================
// Country borders + hover labels (cartoon style)
// NON-BLOCKING: pins will still load if this fails
// =========================
let hoveredCountry = null;

fetch("./data/countries.geojson")
  .then((r) => {
    if (!r.ok) throw new Error(`countries.geojson ${r.status}`);
    return r.json();
  })
  .then((geo) => {
    globe
      .polygonsData(geo.features)

      // Thickness via altitude (still below pins)
      .polygonAltitude((d) =>
        d === hoveredCountry ? 0.0032 : 0.0026
      )

      .polygonCapColor(() => "rgba(0,0,0,0)")
      .polygonSideColor(() => "rgba(0,0,0,0)")

      // 🔥 DARK GREY borders
      .polygonStrokeColor((d) =>
        d === hoveredCountry
          ? "rgba(90,90,90,1.0)"     // hover: darker
          : "rgba(120,120,120,0.95)" // normal
      )

      .polygonLabel((d) =>
        d?.properties?.ADMIN || d?.properties?.name || ""
      )

      .onPolygonHover((d) => {
        hoveredCountry = d;
      });

    console.log("Country borders loaded:", geo.features.length);
  })
  .catch((err) => {
    console.warn("Country borders not loaded:", err);
  });



  if (typeof globe.enablePointerInteraction === "function") globe.enablePointerInteraction(true);

  // Controls
  const controls = globe.controls();
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Slow rotate
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.03; // slower = smaller number (try 0.02–0.08)
  controls.addEventListener("start", stopAutoRotateOnce);

  // Lights
  globe.scene().add(new THREE.AmbientLight(0xffffff, 0.95));
  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(1, 1, 1);
  globe.scene().add(dir);

  // UI
  const panel = makePanel(container);
  disableBlockingOverlays(container);

  // Data
  const { stories: storiesRaw, programs } = await loadSheetData();
  console.log("STORIES LOADED ✅", storiesRaw.length, "PROGRAMS LOADED ✅", programs.length);

  // Cluster nearby stories into non-overlapping pins
  const pins = clusterStories(storiesRaw);
  console.log(`Positioned ${storiesRaw.length} stories as ${pins.length} non-overlapping pins`);

  // Pin size
  const PIN_SCALE = 6.0;

  // Hover tracking
  let lastHovered = null;

  globe
    .objectsData(pins)
    .objectLat((d) => d.lat)
    .objectLng((d) => d.lng)
    .objectAltitude(0.015)
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
    let autoRotateStopped = false;

    function stopAutoRotateOnce() {
      if (autoRotateStopped) return;
      controls.autoRotate = false;
      autoRotateStopped = true;
    }

    .onObjectClick((d) => {
      if (!d) return;
    
      stopAutoRotateOnce();   // ✅ stop rotation on first pin click
    
      panel.open(d);
      if (d.__pinSprite) bouncePin(d.__pinSprite);

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
      controls.autoRotate = false;
      panel.showStory(d.story);
      if (d.__obj) bounce(d.__obj);
    });
    

  // Program rings layer (globe.gl custom layer via rings data)
  globe
    .ringsData(programs)
    .ringLat((d) => d.pin_lat)
    .ringLng((d) => d.pin_lon)
    .ringColor(() => SIGN_BLUE)
    .ringMaxRadius(1.2)
    .ringPropagationSpeed(0)
    .ringRepeatPeriod(0)
    .onRingClick((d) => {
      if (!d) return;
      controls.autoRotate = false;
      // Show a simple info tooltip for program locations
      panel.showStory({
        title: d.name || "Program Location",
        country: d.country || "",
        story_html: `<p>IGN has an active program in <strong>${d.country || d.name}</strong>.</p>`,
        image_url: "",
        source_url: "",
      });
    });

  // Layer toggle UI
  const toggleWrap = document.createElement("div");
  toggleWrap.style.cssText = `
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    z-index: 999999;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  `;

  const makeToggle = (label, color, onToggle, defaultOn = true) => {
    const btn = document.createElement("button");
    let on = defaultOn;
    const update = () => {
      btn.style.cssText = `
        padding: 6px 14px;
        border-radius: 20px;
        border: 2px solid ${color};
        background: ${on ? color : "rgba(255,255,255,0.85)"};
        color: ${on ? "#fff" : color};
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      `;
    };
    btn.textContent = label;
    update();
    btn.onclick = () => { on = !on; update(); onToggle(on); };
    return btn;
  };

  toggleWrap.appendChild(makeToggle("● Patient Stories", SIGN_GREEN, (on) => {
    globe.objectsData(on ? pins : []);
  }));

  toggleWrap.appendChild(makeToggle("● Program Sites", SIGN_BLUE, (on) => {
    globe.ringsData(on ? programs : []);
  }));

  container.appendChild(toggleWrap);

  // Start per-frame anchoring
  const stopAnchoring = startPinAnchoring(globe, () => pins);

  console.log("Globe mounted. Pins:", pins.length, "Programs:", programs.length);

  globe.__signCleanup = () => {
    try {
      stopAnchoring?.();
    } catch {}
  };

  return globe;
}
