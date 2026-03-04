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
  let colsRaw = (json.table.cols || []).map((c) => (c.label ?? ""));
  const allRows = json.table.rows || [];

  // If all column labels are empty, the API didn't pick up the header row —
  // treat the first data row as the header instead.
  let dataRows = allRows;
  if (colsRaw.every((l) => l === "") && allRows.length > 0) {
    colsRaw = (allRows[0].c || []).map((cell, i) =>
      cell && cell.v != null ? String(cell.v) : `col${i}`
    );
    dataRows = allRows.slice(1);
  }

  const cols = colsRaw.map((s) => s.trim().toLowerCase());

  console.log("Sheet headers (raw):", JSON.stringify(colsRaw));
  console.log("Sheet headers (normalized):", JSON.stringify(cols));

  const raw = dataRows.map((r) => {
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
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);

    const progLoc = get(d, "all_prog_locs", "all prog locs");
    const storyHtml = get(d, "story_html", "story html");

    // Row is a program location — capture even without coords (will geocode by country name)
    if (progLoc) {
      programs.push({
        pin_lat: hasCoords ? lat : null,
        pin_lon: hasCoords ? lon : null,
        name: String(progLoc),
        country: String(get(d, "country") ?? ""),
      });
    }

    // Row is a story — requires valid coords
    if (!hasCoords) return;

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

function makePanel(container, { onClose } = {}) {
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

  panel.querySelector("#sg-close").onclick = () => { panel.style.display = "none"; onClose?.(); };

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

/** Build a country-name → centroid lookup from a GeoJSON FeatureCollection */
function buildCountryCentroids(geo) {
  const map = {};
  (geo.features || []).forEach((f) => {
    const name = (f.properties?.ADMIN || f.properties?.name || "").toLowerCase().trim();
    if (!name) return;
    const geom = f.geometry;
    let ring;
    if (geom.type === "MultiPolygon") {
      ring = geom.coordinates.reduce(
        (best, poly) => (poly[0].length > best.length ? poly[0] : best),
        geom.coordinates[0][0]
      );
    } else {
      ring = geom.coordinates[0];
    }
    let sumLat = 0, sumLon = 0;
    for (const [lon, lat] of ring) { sumLon += lon; sumLat += lat; }
    map[name] = { lat: sumLat / ring.length, lon: sumLon / ring.length };
  });
  return map;
}

function approxDistDeg(aLat, aLng, bLat, bLng) {
  const lonScale = Math.max(0.25, Math.cos((aLat * Math.PI) / 180));
  const dLat = aLat - bLat;
  const dLng = (aLng - bLng) * lonScale;
  return Math.hypot(dLat, dLng);
}

/**
 * Groups nearby stories into cluster pins, then spaces them apart.
 * Returns [{ lat, lng, stories: [...] }]
 */
function clusterStories(stories) {
  if (stories.length === 0) return [];

  const CLUSTER_THRESH_DEG = 1.0; // stories within ~110km share one pin
  const MIN_SPACING_DEG = 3.5;    // minimum spacing between pins after relaxation
  const MAX_ITERATIONS = 50;

  // Step 1: group nearby stories into clusters
  const used = new Set();
  const clusters = [];
  for (let i = 0; i < stories.length; i++) {
    if (used.has(i)) continue;
    const group = [stories[i]];
    used.add(i);
    for (let j = i + 1; j < stories.length; j++) {
      if (used.has(j)) continue;
      if (approxDistDeg(stories[i].pin_lat, stories[i].pin_lon, stories[j].pin_lat, stories[j].pin_lon) < CLUSTER_THRESH_DEG) {
        group.push(stories[j]);
        used.add(j);
      }
    }
    const lat = group.reduce((s, x) => s + x.pin_lat, 0) / group.length;
    const lng = group.reduce((s, x) => s + x.pin_lon, 0) / group.length;
    clusters.push({ lat, lng, stories: group });
  }

  // Step 2: spread clusters apart so pins don't visually overlap
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let hadCollision = false;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const dist = approxDistDeg(clusters[i].lat, clusters[i].lng, clusters[j].lat, clusters[j].lng);
        if (dist < MIN_SPACING_DEG && dist > 0.0001) {
          hadCollision = true;
          const pushDist = (MIN_SPACING_DEG - dist) / 2;
          const lonScale = Math.max(0.25, Math.cos((clusters[i].lat * Math.PI) / 180));
          const dLat = clusters[j].lat - clusters[i].lat;
          const dLng = (clusters[j].lng - clusters[i].lng) * lonScale;
          const len = Math.sqrt(dLat * dLat + dLng * dLng);
          if (len > 0.0001) {
            clusters[i].lat -= (dLat / len) * pushDist;
            clusters[i].lng -= (dLng / len) * pushDist / lonScale;
            clusters[j].lat += (dLat / len) * pushDist;
            clusters[j].lng += (dLng / len) * pushDist / lonScale;
          }
        }
      }
    }
    if (!hadCollision) { console.log(`Cluster spacing converged in ${iter + 1} iterations`); break; }
  }

  return clusters;
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
// Country borders + geocoding (shared geojson fetch)
// =========================
let hoveredCountry = null;

const geojsonPromise = fetch("./data/countries.geojson")
  .then((r) => { if (!r.ok) throw new Error(`countries.geojson ${r.status}`); return r.json(); })
  .catch((err) => { console.warn("Country borders not loaded:", err); return null; });

// Borders + program shading are set up after data loads (see below)



  if (typeof globe.enablePointerInteraction === "function") globe.enablePointerInteraction(true);

  // Controls
  const controls = globe.controls();
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Slow rotate — pauses when a story panel is open, resumes on close
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.03;

  // Lights
  globe.scene().add(new THREE.AmbientLight(0xffffff, 0.95));
  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(1, 1, 1);
  globe.scene().add(dir);

  // UI — resume auto-rotate when the panel is closed
  const panel = makePanel(container, { onClose: () => { controls.autoRotate = true; } });
  disableBlockingOverlays(container);

  // Load geojson + sheet data in parallel
  const [geo, { stories: storiesRaw, programs: programsRaw }] = await Promise.all([
    geojsonPromise,
    loadSheetData(),
  ]);
  console.log("STORIES LOADED", storiesRaw.length, "PROGRAMS RAW ✅", programsRaw.length);

  // Geocode programs that have a country name but no coordinates
  const centroids = geo ? buildCountryCentroids(geo) : {};
  const programs = programsRaw
    .map((p) => {
      if (p.pin_lat !== null && p.pin_lon !== null) return p;
      const c = centroids[p.country.toLowerCase().trim()];
      return c ? { ...p, pin_lat: c.lat, pin_lon: c.lon } : p;
    })
    .filter((p) => Number.isFinite(p.pin_lat) && Number.isFinite(p.pin_lon));
  console.log("PROGRAMS GEOCODED ✅", programs.length);

  // Set up country borders + program shading (needs both geo and program list)
  const programCountries = new Set(
    programs.map((p) => p.country.toLowerCase().trim()).filter(Boolean)
  );
  const programCapColor = (d) => {
    const name = (d.properties?.ADMIN || d.properties?.name || "").toLowerCase().trim();
    return programCountries.has(name) ? "rgba(46,134,171,0.45)" : "rgba(0,0,0,0)";
  };
  if (geo) {
    globe
      .polygonsData(geo.features)
      .polygonAltitude((d) => d === hoveredCountry ? 0.0032 : 0.0026)
      .polygonCapColor(programCapColor)
      .polygonSideColor(() => "rgba(0,0,0,0)")
      .polygonStrokeColor((d) =>
        d === hoveredCountry ? "rgba(90,90,90,1.0)" : "rgba(120,120,120,0.95)"
      )
      .polygonLabel((d) => d?.properties?.ADMIN || d?.properties?.name || "")
      .onPolygonHover((d) => { hoveredCountry = d; });
    console.log("Country borders + program shading loaded:", geo.features.length);

    // Country name labels — visible when zoomed in (altitude < 1.5)
    const countryLabels = geo.features
      .map((f) => {
        const name = f.properties?.ADMIN || f.properties?.name || "";
        if (!name) return null;
        const c = centroids[name.toLowerCase().trim()];
        return c ? { name, lat: c.lat, lon: c.lon } : null;
      })
      .filter(Boolean);

    globe
      .htmlElementsData([])
      .htmlLat((d) => d.lat)
      .htmlLng((d) => d.lon)
      .htmlAltitude(0.004)
      .htmlElement((d) => {
        const el = document.createElement("div");
        el.textContent = d.name;
        el.style.cssText = `
          font-family: sans-serif;
          font-size: 11px;
          font-weight: 300;
          color: rgba(255,255,255,0.92);
          text-shadow: 0 1px 2px rgba(0,0,0,0.6);
          pointer-events: none;
          white-space: nowrap;
          user-select: none;
        `;
        return el;
      });

    let labelsVisible = false;
    controls.addEventListener("change", () => {
      const { altitude } = globe.pointOfView();
      const shouldShow = altitude < 1.5;
      if (shouldShow !== labelsVisible) {
        labelsVisible = shouldShow;
        globe.htmlElementsData(shouldShow ? countryLabels : []);
      }
    });
  }

  // Cluster nearby stories into non-overlapping pins
  // Tag each pin with an index so we can give them unique altitudes (prevents z-fighting)
  const pins = clusterStories(storiesRaw).map((p, i) => ({ ...p, _idx: i }));
  console.log(`Positioned ${storiesRaw.length} stories as ${pins.length} non-overlapping pins`);

  // Pin size
  const PIN_SCALE = 6.0;

  // Hover tracking
  let lastHovered = null;

  globe
    .objectsData(pins)
    .objectLat((d) => d.lat)
    .objectLng((d) => d.lng)
    .objectAltitude((d) => 0.015 + d._idx * 0.0005)
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
      controls.autoRotate = false;
      if (d.__obj) bounce(d.__obj);
      if (d.stories.length === 1) {
        panel.showStory(d.stories[0]);
      } else {
        panel.showCluster({
          title: `${d.stories.length} stories nearby`,
          meta: d.stories[0]?.country || "",
          items: d.stories,
          onPick: (story) => panel.showStory(story),
          onHover: () => {},
        });
      }
    });

  // Scale pins up as you zoom in (altitude 1.5 → 1x, altitude 0.5 → 2x)
  controls.addEventListener("change", () => {
    const { altitude } = globe.pointOfView();
    const s = Math.max(1.0, Math.min(2.0, 1.5 / Math.max(0.1, altitude)));
    for (const pin of pins) {
      if (pin.__obj) pin.__obj.scale.setScalar(s);
    }
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

  const makeToggle = (label, subtitle, color, onToggle, defaultOn = true) => {
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
        text-align: center;
        line-height: 1.3;
      `;
    };
    btn.innerHTML = `<div>${label}</div><div style="font-size:10px; font-weight:400; opacity:0.85; margin-top:1px;">${subtitle}</div>`;
    update();
    btn.onclick = () => { on = !on; update(); onToggle(on); };
    return btn;
  };

  toggleWrap.appendChild(makeToggle("● Patient Stories", "Click on a pin to learn more", SIGN_GREEN, (on) => {
    globe.objectsData(on ? pins : []);
  }));

  toggleWrap.appendChild(makeToggle("● Program Countries", "Shaded countries represent SIGN program locations", SIGN_BLUE, (on) => {
    globe.polygonCapColor(on ? programCapColor : () => "rgba(0,0,0,0)");
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
