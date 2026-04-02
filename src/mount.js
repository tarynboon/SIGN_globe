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

    const progLoc = get(d, "program_countries", "all_prog_locs", "all prog locs");
    const storyHtml = get(d, "story_html", "story html");

    // Row is a program location — capture even without coords (will geocode by country name)
    if (progLoc) {
      programs.push({
        pin_lat: hasCoords ? lat : null,
        pin_lon: hasCoords ? lon : null,
        name: String(get(d, "hospital_name", "program_name", "hospital / program") ?? progLoc),
        city: String(get(d, "city_name") ?? ""),
        country: String(get(d, "country_name", "country") ?? progLoc ?? ""),
        progLoc: String(progLoc),
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
        country: String(get(d, "country", "country_name") ?? ""),
        story_html: String(storyHtml),
        image_url: String(get(d, "image_url", "image url") ?? ""),
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
    font-family: 'Nunito', system-ui, sans-serif;
`;


  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
      <div>
        <div id="sg-title" style="font-weight:800;font-size:16px;font-family:'Montserrat',sans-serif;"></div>
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

      <!-- Flip card (stories with a photo) -->
      <div id="sg-flip-wrap" style="display:none; margin-top:10px;">
        <div id="sg-flip-inner" style="width:100%; border-radius:10px; overflow:hidden;">
          <!-- Front: photo -->
          <div id="sg-flip-front" style="
            cursor:pointer; background:#f3f3f3; border-radius:10px; overflow:hidden;
            position:relative;
          ">
            <img id="sg-img" style="width:100%;max-height:min(360px,52vh);object-fit:contain;display:block;" />
            <div style="
              position:absolute; bottom:0; left:0; right:0;
              background:linear-gradient(transparent, rgba(0,0,0,0.55));
              color:#fff; font-size:14px; font-weight:700;
              font-family:'Montserrat',sans-serif;
              padding:28px 16px 12px;
              text-align:center; pointer-events:none;
              letter-spacing:0.02em;
            ">
              Click anywhere on photo to read the story →
            </div>
          </div>
          <!-- Back: story text -->
          <div id="sg-flip-back" style="display:none; padding:14px; background:#fafafa;
            border:1px solid rgba(0,0,0,0.08); border-radius:10px; box-sizing:border-box;">
            <div id="sg-body" style="line-height:1.45; font-size:14px;"></div>
            <div style="
              margin-top:16px; padding:10px 0 4px;
              border-top:1px solid rgba(0,0,0,0.08);
              text-align:center; color:#888; font-size:13px; font-weight:700;
              font-family:'Montserrat',sans-serif; letter-spacing:0.02em;
            ">
              <button id="sg-flip-back-btn" style="
                background:none; border:none; font-size:13px; font-weight:700;
                font-family:'Montserrat',sans-serif; color:#888; cursor:pointer;
                letter-spacing:0.02em;
              ">← Click anywhere to see photo</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Text-only view (stories without a photo) -->
      <div id="sg-body-solo" style="display:none; margin-top:10px; line-height:1.45; font-size:14px;"></div>

    </div>
  `;

  container.appendChild(panel);

  const titleEl = panel.querySelector("#sg-title");
  const metaEl = panel.querySelector("#sg-meta");

  const clusterWrap = panel.querySelector("#sg-cluster");
  const listEl = panel.querySelector("#sg-list");

  const storyWrap = panel.querySelector("#sg-story");

  // Flip card elements (stories with photo)
  const flipWrap = panel.querySelector("#sg-flip-wrap");
  const flipInner = panel.querySelector("#sg-flip-inner");
  const imgEl = panel.querySelector("#sg-img");
  const bodyEl = panel.querySelector("#sg-body");

  // Text-only elements (stories without photo)
  const bodySolo = panel.querySelector("#sg-body-solo");

  const flipFront = panel.querySelector("#sg-flip-front");
  const flipBack = panel.querySelector("#sg-flip-back");

  const doFlip = (showBack) => {
    flipInner.style.transition = "transform 0.15s ease-in";
    flipInner.style.transform = "scaleX(0)";
    setTimeout(() => {
      flipFront.style.display = showBack ? "none" : "block";
      flipBack.style.display = showBack ? "block" : "none";
      flipInner.style.transition = "transform 0.15s ease-out";
      flipInner.style.transform = "scaleX(1)";
    }, 150);
  };

  flipFront.addEventListener("click", () => doFlip(true));
  flipBack.addEventListener("click", () => doFlip(false));

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
      // Flip card: start on photo side
      flipInner.style.transform = "scaleX(1)";
      flipFront.style.display = "block";
      flipBack.style.display = "none";
      imgEl.src = story.image_url;
      bodyEl.innerHTML = story.story_html || "";
      flipWrap.style.display = "block";
      bodySolo.style.display = "none";
    } else {
      // No photo — show text directly
      flipWrap.style.display = "none";
      imgEl.src = "";
      bodySolo.innerHTML = story.story_html || "";
      bodySolo.style.display = "block";
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
const STORY_BLUE = "#2B7EC1";

// Cache one texture per color so we don't recreate canvases for every dot
const _dotTextureCache = {};

function makeDotSprite(color) {
  if (!_dotTextureCache[color]) {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    _dotTextureCache[color] = texture;
  }
  const mat = new THREE.SpriteMaterial({
    map: _dotTextureCache[color],
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
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [lon, lat] of ring) {
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    }
    map[name] = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
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

  // Inject Google Fonts if not already present
  if (!document.querySelector('link[data-sg-fonts]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.sgFonts = "1";
    link.href = "https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Nunito:wght@400;600;700&display=swap";
    document.head.appendChild(link);
  }

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
    .globeImageUrl(null)
    .atmosphereColor("rgba(180,215,245,0.5)")
    .backgroundColor("rgba(0,0,0,0)");

  // Set globe sphere to pure flat gray — driven entirely by emissive so lighting doesn't
  // brighten it and create visible white gaps where polygon data has holes.
  const globeMat = globe.globeMaterial();
  globeMat.color.set(0x000000);
  globeMat.emissive.set(0xc8cbd0);
  globeMat.emissiveIntensity = 1.0;
  globeMat.shininess = 0;

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

  // Lights — high ambient for flat/even look
  globe.scene().add(new THREE.AmbientLight(0xffffff, 2.0));
  const dir = new THREE.DirectionalLight(0xffffff, 0.2);
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
  // Many GeoJSON files use long official country names (e.g. "United Republic of Tanzania")
  // while the spreadsheet uses short common names ("Tanzania"). This map normalizes both sides.
  const COUNTRY_NAME_ALIASES = {
    "tanzania": "united republic of tanzania",
    "dr congo": "democratic republic of the congo",
    "democratic republic of congo": "democratic republic of the congo",
    "congo - kinshasa": "democratic republic of the congo",
    "congo, dem. rep.": "democratic republic of the congo",
    "congo - brazzaville": "republic of congo",
    "republic of the congo": "republic of congo",
    "syria": "syrian arab republic",
    "laos": "lao pdr",
    "vietnam": "viet nam",
    "viet nam": "viet nam",
    "việt nam": "viet nam",
    "czechia": "czech republic",
    "czech republic": "czechia",
  };
  const normalizeCountry = (s) => {
    const n = (s || "").toLowerCase().trim();
    return COUNTRY_NAME_ALIASES[n] || n;
  };

  // Build from both country field and the raw program_countries column value (stored as p.country
  // with progLoc fallback) so nothing is missed even if country_name is blank in some rows.
  const programCountries = new Set(
    programs.flatMap((p) => [p.country, p.progLoc].map(normalizeCountry)).filter(Boolean)
  );
  console.log("Program countries (normalized):", [...programCountries].sort());
  if (geo) {
    const vnFeature = geo.features.find(f => /viet|vietnam/i.test(f.properties?.ADMIN || f.properties?.name || ""));
    console.log("Vietnam GeoJSON name:", vnFeature?.properties?.ADMIN || vnFeature?.properties?.name || "NOT FOUND");
  }
  const programCapColor = (d) => {
    const name = normalizeCountry(d.properties?.ADMIN || d.properties?.name || "");
    return programCountries.has(name) ? "rgba(249,159,30,0.85)" : "rgba(200,203,208,1.0)";
  };
  if (geo) {
    globe
      .polygonsData(geo.features)
      .polygonAltitude((d) => {
        if (d === hoveredCountry) return 0.012;
        const name = normalizeCountry(d.properties?.ADMIN || d.properties?.name || "");
        return programCountries.has(name) ? 0.008 : 0.002;
      })
      .polygonCapColor(programCapColor)
      .polygonSideColor(() => "rgba(0,0,0,0)")
      .polygonStrokeColor((d) =>
        d === hoveredCountry ? "rgba(80,80,80,1.0)" : "rgba(150,153,158,0.9)"
      )
      .polygonLabel((d) => d?.properties?.ADMIN || d?.properties?.name || "")
      .onPolygonHover((d) => { hoveredCountry = d; });
    console.log("Country borders + program shading loaded:", geo.features.length);

    // Country name labels + program location labels — visible when zoomed in (altitude < 1.5)
    const countryLabels = geo.features
      .map((f) => {
        const name = f.properties?.ADMIN || f.properties?.name || "";
        if (!name) return null;
        const nameLower = name.toLowerCase().trim();
        if (!programCountries.has(nameLower)) return null;
        const c = centroids[nameLower];
        return c ? { name, lat: c.lat, lon: c.lon } : null;
      })
      .filter(Boolean);

    const allLabels = [...countryLabels];

    globe
      .htmlElementsData([])
      .htmlLat((d) => d.lat)
      .htmlLng((d) => d.lon)
      .htmlAltitude(0.006)
      .htmlElement((d) => {
        const el = document.createElement("div");
        el.textContent = d.name;
        el.style.cssText = `
          font-family: 'Nunito', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: rgba(70,70,70,0.9);
          text-shadow: 0 1px 2px rgba(255,255,255,0.8);
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
        globe.htmlElementsData(shouldShow ? allLabels : []);
      }
    });
  }

  const pins = clusterStories(storiesRaw);
  console.log(`Positioned ${storiesRaw.length} stories as ${pins.length} pins`);

  // Keep track of all pin sprites so we can rescale them on zoom
  const pinSprites = [];
  const PIN_BASE_SCALE = 2.2;
  const PIN_BASE_ALT = 2.0;

  const updatePinScale = () => {
    const { altitude } = globe.pointOfView();
    const scale = PIN_BASE_SCALE * (1 + altitude) / (1 + PIN_BASE_ALT);
    for (const s of pinSprites) s.scale.set(scale, scale, 1);
  };
  controls.addEventListener("change", updatePinScale);
  setTimeout(updatePinScale, 100);

  // Normalise programs to same lat/lng shape as story pins
  const storyDots = pins.map((p) => ({ ...p, _type: "story" }));
  const programDots = programs.map((p) => ({ ...p, lat: p.pin_lat, lng: p.pin_lon, _type: "program" }));

  let showStories = true;
  let showPrograms = true;
  const updateDots = () => globe.objectsData([
    ...(showStories ? storyDots : []),
    ...(showPrograms ? programDots : []),
  ]);

  globe
    .objectsData([...storyDots, ...programDots])
    .objectLat((d) => d.lat)
    .objectLng((d) => d.lng)
    .objectAltitude(0.018)
    .objectThreeObject((d) => {
      const s = makeDotSprite(d._type === "story" ? STORY_BLUE : SIGN_GREEN);
      pinSprites.push(s);
      return s;
    })
    .onObjectHover((d) => {
      const c = container.querySelector("canvas");
      const cur = d ? "default" : "grab";
      if (c) c.style.cursor = cur;
      container.style.cursor = cur;
    })
    .onObjectClick((d) => {
      if (!d || d._type !== "story") return;
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
    font-family: 'Nunito', system-ui, sans-serif;
  `;

  const makeToggle = (label, subtitle, color, onToggle, defaultOn = true) => {
    const btn = document.createElement("button");
    let on = defaultOn;
    const update = () => {
      btn.style.cssText = `
        padding: 17px 34px;
        border-radius: 20px;
        border: 2px solid ${color};
        background: ${on ? color : "rgba(255,255,255,0.85)"};
        color: ${on ? "#fff" : color};
        font-size: 17px;
        font-weight: 600;
        cursor: default;
        transition: all 0.15s;
        text-align: center;
        line-height: 1.3;
      `;
    };
    btn.innerHTML = `<div style="font-family:'Montserrat',sans-serif;">${label}</div><div style="font-size:12px; font-weight:400; opacity:0.85; margin-top:1px; font-family:'Nunito',sans-serif;">${subtitle}</div><div style="font-size:10px; font-weight:400; opacity:0.65; margin-top:2px; font-family:'Nunito',sans-serif;">Click to toggle on/off</div>`;
    update();
    btn.onclick = () => { on = !on; update(); onToggle(on); };
    return btn;
  };

  toggleWrap.appendChild(makeToggle("● Patient Stories", "Click on a pin to learn more", STORY_BLUE, (on) => {
    showStories = on; updateDots();
  }));

  toggleWrap.appendChild(makeToggle("● Program Countries", "Shaded countries represent SIGN program locations", SIGN_BLUE, (on) => {
    globe.polygonCapColor(on ? programCapColor : () => "rgba(200,203,208,0.9)");
  }));

  toggleWrap.appendChild(makeToggle("● Program Locations", "Dots show specific SIGN program sites", SIGN_GREEN, (on) => {
    showPrograms = on; updateDots();
  }));

  container.appendChild(toggleWrap);

  globe.pointOfView({ altitude: 2.0 });

  console.log("Globe mounted. Pins:", pins.length, "Programs:", programs.length);

  globe.__signCleanup = () => {
  };

  return globe;
}
