// src/mount.js
import Globe from "globe.gl";
import * as THREE from "three";

console.log("SIGN GLOBE BUILD:", "2026-01-22 pin-3d-green-v46");

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

function makePanel(container) {
  const panel = document.createElement("div");
  panel.dataset.sgPanel = "1";

  panel.style.cssText = `
    position:absolute;
    right:16px;
    top:16px;
    width:min(420px, 92%);
    max-height:80vh;
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

    overlays.forEach((el) => (el.style.pointerEvents = "none"));

    const panel = container.querySelector('[data-sg-panel="1"]');
    if (panel) panel.style.pointerEvents = "auto";

    if (tries < 40) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** =========================
 *  Pin visuals + interactions
 *  ========================= */

const SIGN_GREEN = "#81BC41";
const SIGN_OUTLINE = "#2d6a1f";

function makePinInstance({ height = 0.65, radius = 0.06, headRadius = 0.12 } = {}) {
  const group = new THREE.Group();

  // Per-pin material so hover affects one pin only
  const mat = new THREE.MeshStandardMaterial({
    color: SIGN_GREEN,
    emissive: new THREE.Color(SIGN_GREEN),
    emissiveIntensity: 0.25,
    roughness: 0.25,
    metalness: 0.0,
  });

  // shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 14), mat);
  shaft.position.y = height / 2;
  group.add(shaft);

  // head
  const headY = height + headRadius * 0.72;
  const head = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 18, 18), mat);
  head.position.y = headY;
  group.add(head);

  // outline (BackSide outline)
  const outline = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius * 1.14, 18, 18),
    new THREE.MeshBasicMaterial({ color: SIGN_OUTLINE, side: THREE.BackSide })
  );
  outline.position.y = headY;
  group.add(outline);

  // white dot
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(headRadius * 0.45, 28),
    new THREE.MeshBasicMaterial({ color: "#ffffff" })
  );
  dot.position.set(0, headY, headRadius * 1.18);
  group.add(dot);

  // BIG invisible click collider (fixes “pins not clickable / hover not firing”)
  const collider = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius * 2.2, 12, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })
  );
  collider.position.y = headY;
  group.add(collider);

  group.userData.pinMat = mat;
  group.userData.baseScale = 25; // tweak size here (smaller -> smaller pins)
  group.scale.set(group.userData.baseScale, group.userData.baseScale, group.userData.baseScale);

  // push peg slightly into globe
  group.position.y = -0.10;

  group.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });

  return group;
}

function setPinGlow(pin, on) {
  const m = pin?.userData?.pinMat;
  if (!m) return;

  m.emissiveIntensity = on ? 0.95 : 0.25;

  const base = pin.userData.baseScale ?? 95;
  const target = on ? base * 1.08 : base;
  pin.scale.set(target, target, target);
}

function bouncePin(pin) {
  if (!pin) return;

  const baseY = pin.userData.baseY ?? pin.position.y;
  pin.userData.baseY = baseY;

  pin.userData.bouncing = true;
  const start = performance.now();
  const DURATION = 520;
  const AMP = 0.22;

  function frame(t) {
    if (!pin.userData.bouncing) return;

    const p = Math.min(1, (t - start) / DURATION);
    const s = Math.sin(p * Math.PI) * (1 - p);

    pin.position.y = baseY + s * AMP;

    const base = pin.userData.baseScale ?? 95;
    const k = 1 + s * 0.18;
    pin.scale.set(base * k, base * (1 + s * 0.28), base * k);

    if (p < 1) requestAnimationFrame(frame);
    else {
      pin.position.y = baseY;
      pin.scale.set(base, base, base);
      pin.userData.bouncing = false;
    }
  }

  requestAnimationFrame(frame);
}

// Allow multiple pins at same lat/lon by spreading them slightly
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
        (jitterDeg * Math.sin(angle)) / Math.max(0.2, Math.cos((baseLat * Math.PI) / 180));

      out.push({ ...s, pin_lat: baseLat + dLat, pin_lon: baseLon + dLon });
    });
  }
  return out;
}

/** =========================
 *  Mount
 *  ========================= */

export async function mountSignGlobe({ containerId = "sign-globe", height = 650 } = {}) {
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

  const controls = globe.controls();
  controls.enabled = true;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.001;

  globe.scene().add(new THREE.AmbientLight(0xffffff, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(1, 1, 1);
  globe.scene().add(dir);

  const panel = makePanel(container);
  disableBlockingOverlays(container);

  const storiesRaw = await loadStoriesFromGoogleSheet();
  const stories = jitterDuplicatesByLatLng(storiesRaw, 0.10);

  // Keep a list of pin objects so we can orient them reliably
  const pins = [];

  let lastHovered = null;

  globe
    .objectsData(stories)
    .objectLat((d) => d.pin_lat)
    .objectLng((d) => d.pin_lon)
    .objectAltitude(0.06) // sticks out more
    .objectThreeObject((d) => {
      const pin = makePinInstance();

      // store on datum for hover/click
      d.__pin = pin;
      pins.push(pin);

      return pin;
    })
    .onObjectHover((d) => {
      if (lastHovered && lastHovered !== d) setPinGlow(lastHovered.__pin, false);

      if (d && d.__pin) {
        setPinGlow(d.__pin, true);
        lastHovered = d;
      } else {
        lastHovered = null;
      }
    })
    .onObjectClick((d) => {
      if (!d) return;
      panel.open(d);
      if (d.__pin) bouncePin(d.__pin);
    });

  // ✅ Orient pins to globe normal + add 45° tilt
  // (do it in a rAF loop so it works consistently after globe positions them)
  const up = new THREE.Vector3(0, 1, 0);
  const outward = new THREE.Vector3();
  const tilt = THREE.MathUtils.degToRad(45);

  function orientAllPins() {
    for (const pin of pins) {
      if (!pin) continue;

      // pin.position is already at the right globe coordinate.
      // Its direction from center is the surface normal.
      outward.copy(pin.position).normalize();

      // make pin's +Y axis point outward
      pin.quaternion.setFromUnitVectors(up, outward);

      // then tilt it "forward" by 45°
      pin.rotateX(-tilt);
    }
    requestAnimationFrame(orientAllPins);
  }
  requestAnimationFrame(orientAllPins);

  console.log("Globe mounted. Pins:", stories.length);
  return globe;
}
