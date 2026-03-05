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

function makePanel(container, { onClose, onOpen } = {}) {
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
        "
      ></div>

      <div style="margin-top:14px;">
        <a id="sg-src" href="#" target="_blank" rel="noopener"
          style="display:none; padding:9px 18px; background:#81BC41; color:#fff;
            border-radius:8px; font-weight:700; font-size:14px; text-decoration:none;
            letter-spacing:0.01em;">Read on SIGN</a>
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

  const show = () => {
    panel.style.display = "block";
    if (window.innerWidth < 768) {
      panel.style.left = "4%";
      panel.style.right = "4%";
      panel.style.width = "auto";
      panel.style.top = "12px";
    } else {
      panel.style.left = "";
      panel.style.right = "16px";
      panel.style.width = "min(420px, 92%)";
      panel.style.top = "16px";
    }
    onOpen?.();
  };

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
      if (el.dataset.sgUi === "1") return false;
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

const SIGN_BLUE = "#F99F1E";

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

const SIGN_GREEN = "#81BC41";
const SIGN_DARK_GREEN = "#45842E";

function makePinSprite() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - 4;
  const innerR = outerR - 10;

  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.fillStyle = SIGN_DARK_GREEN;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = SIGN_GREEN;
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.2, 3.2, 1);
  sprite.renderOrder = 999;

  return sprite;
}


/** =========================
 *  Per-frame anchoring (vertical pin with fan-out)
 *  - head up (away from center)
 *  - tip down (toward center)
 *  - rotated around vertical axis for fan-out effect
 *  ========================= */


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

export async function mountSignGlobe({
  containerId = "sign-globe",
  height = 650,
  geojsonUrl = "https://tarynboon.github.io/SIGN_globe/data/countries.geojson",
} = {}) {
  console.log("MOUNT RUNNING");

  const container = document.getElementById(containerId);
  if (!container) throw new Error(`Missing #${containerId}`);

  container.style.position = "relative";
  container.style.height = typeof height === "number" ? `${height}px` : height;
  container.style.width = "100%";
  container.style.touchAction = "none";
  container.addEventListener("wheel", (e) => {
    // Allow wheel scrolling inside the story panel
    if (e.target.closest('[data-sg-panel="1"]')) return;
    e.preventDefault();
  }, { passive: false });

  const globe = Globe()(container)
    .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg")
    .backgroundColor("rgba(0,0,0,0)");

// =========================
// Country borders + geocoding (shared geojson fetch)
// =========================
let hoveredCountry = null;

const geojsonPromise = fetch(geojsonUrl)
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

  // UI — resume auto-rotate + show toggle buttons when the panel is closed
  let toggleWrap;
  const panel = makePanel(container, {
    onClose: () => {
      controls.autoRotate = true;
      if (toggleWrap) toggleWrap.style.display = "flex";
    },
    onOpen: () => {
      if (toggleWrap) toggleWrap.style.display = "none";
    },
  });
  disableBlockingOverlays(container);

  // Load geojson + sheet data in parallel
  const [geo, { stories: storiesRaw, programs: programsRaw }] = await Promise.all([
    geojsonPromise,
    loadSheetData(),
  ]);
  console.log("STORIES LOADED", storiesRaw.length, "PROGRAMS RAW", programsRaw.length);

  // Geocode programs that have a country name but no coordinates
  const centroids = geo ? buildCountryCentroids(geo) : {};
  const programs = programsRaw
    .map((p) => {
      if (p.pin_lat !== null && p.pin_lon !== null) return p;
      const c = centroids[p.country.toLowerCase().trim()];
      return c ? { ...p, pin_lat: c.lat, pin_lon: c.lon } : p;
    })
    .filter((p) => Number.isFinite(p.pin_lat) && Number.isFinite(p.pin_lon));
  console.log("PROGRAMS GEOCODED", programs.length);

  // Set up country borders + program shading (needs both geo and program list)
  const programCountries = new Set(
    programs.map((p) => p.country.toLowerCase().trim()).filter(Boolean)
  );
  const programCapColor = (d) => {
    const name = (d.properties?.ADMIN || d.properties?.name || "").toLowerCase().trim();
    return programCountries.has(name) ? "rgba(249,159,30,0.7)" : "rgba(0,0,0,0)";
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

  const pins = clusterStories(storiesRaw);
  console.log(`Positioned ${storiesRaw.length} stories as ${pins.length} pins`);

  globe
    .objectsData(pins)
    .objectLat((d) => d.lat)
    .objectLng((d) => d.lng)
    .objectAltitude(0.009)
    .objectThreeObject(() => makePinSprite())
    .onObjectHover((d) => {
      const c = container.querySelector("canvas");
      const cur = d ? "default" : "grab";
      if (c) c.style.cursor = cur;
      container.style.cursor = cur;
    })
    .onObjectClick((d) => {
      if (!d) return;
      controls.autoRotate = false;
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


  // Layer toggle UI
  toggleWrap = document.createElement("div");
  toggleWrap.dataset.sgUi = "1";
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
        padding: 16px 32px;
        border-radius: 24px;
        border: 2px solid ${color};
        background: ${on ? color : "rgba(255,255,255,0.85)"};
        color: ${on ? "#fff" : color};
        font-size: 16px;
        font-weight: 600;
        cursor: default;
        transition: all 0.15s;
        text-align: center;
        line-height: 1.3;
      `;
    };
    btn.innerHTML = `<div>${label}</div><div style="font-size:12px; font-weight:400; opacity:0.85; margin-top:2px;">${subtitle}</div><div style="font-size:11px; font-weight:400; opacity:0.65; margin-top:3px;">Click to toggle on/off</div>`;
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

  globe.pointOfView({ altitude: 2.0 });

  console.log("Globe mounted. Pins:", pins.length, "Programs:", programs.length);

  globe.__signCleanup = () => {
  };

  return globe;
}
