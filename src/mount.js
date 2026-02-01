// src/mount.js
import Globe from "globe.gl";
import * as THREE from "three";

console.log("SIGN GLOBE BUILD:", "2026-01-31 pins-teardrop-tip-anchor-v1");

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
    if (s.includes(",") && !s.includes(".")) {
      s = s.replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
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

/** ---------------------------
 *  Panel UI
 *  -------------------------- */
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
      <button id="sg-close" style="cursor:pointer; font-size:18px; line-height:1;">×</button>
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

/** ---------------------------
 *  Pins (teardrop sprite)
 *  Tip anchored at (0,0,0)
 *  -------------------------- */

const SIGN_GREEN = "#81BC41";
const SIGN_GREEN_DARK = "#2d6a1f";
const PIN_SIZE = 9.0; // 👈 make smaller/larger (try 7.5 or 6.5)

// Draw a teardrop pin on a canvas and return a THREE texture
function makeTeardropTexture({ w = 256, h = 384 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const headY = h * 0.32;
  const r = w * 0.22;
  const tipY = h * 0.93;

  // Main pin path
  const path = new Path2D();
  path.arc(cx, headY, r, 0, Math.PI * 2);
  path.moveTo(cx - r * 0.95, headY + r * 0.10);
  path.bezierCurveTo(cx - r * 1.35, headY + r * 1.05, cx - r * 0.55, headY + r * 2.55, cx, tipY);
  path.bezierCurveTo(cx + r * 0.55, headY + r * 2.55, cx + r * 1.35, headY + r * 1.05, cx + r * 0.95, headY + r * 0.10);
  path.closePath();

  // Shadow (subtle)
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.20)";
  ctx.shadowBlur = w * 0.06;
  ctx.shadowOffsetY = h * 0.01;

  // Fill
  ctx.fillStyle = SIGN_GREEN;
  ctx.fill(path);

  // Outline
  ctx.lineWidth = w * 0.05;
  ctx.strokeStyle = SIGN_GREEN_DARK;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(path);

  ctx.restore();

  // Inner white dot
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(cx, headY, r * 0.45, 0, Math.PI * 2);
  ctx.fill();

  // Small dark dot (optional “depth”)
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.arc(cx, headY + r * 0.10, r * 0.22, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// A group with TWO sprites: front + back (so you don't see "through" it from behind)
function makeTeardropPinSprite() {
  const group = new THREE.Group();

  const tex = makeTeardropTexture();

  const makeSprite = () => {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    // scale in world units
    s.scale.set(PIN_SIZE, PIN_SIZE * 1.45, 1);
    // anchor near the tip so the TIP is at y=0
    // sprite center: (0.5, 0) would be bottom, but teardrop has extra blank margin.
    // 0.03 is a good “tip anchor” for this drawing.
    s.center.set(0.5, 0.03);
    return s;
  };

  const front = makeSprite();
  group.add(front);

  const back = makeSprite();
  back.rotateY(Math.PI); // face opposite direction
  group.add(back);

  // Make the group origin be the tip point (0,0,0)
  // Since we anchored sprite centers to the tip, group origin is already correct.

  // Keep refs for hover glow
  group.userData.frontMat = front.material;
  group.userData.backMat = back.material;
  group.userData.baseScale = 1;

  return group;
}

// Hover glow: brighten (simple emissive-like effect via opacity + color)
function setPinGlow(pinGroup, on) {
  if (!pinGroup?.userData?.frontMat) return;
  const a = on ? 1.0 : 1.0;
  pinGroup.userData.frontMat.opacity = a;
  pinGroup.userData.backMat.opacity = a;

  // slight scale bump
  const target = on ? 1.08 : 1.0;
  pinGroup.scale.set(target, target, target);
}

// Click bounce
function bouncePin(pinGroup) {
  if (!pinGroup) return;

  const baseY = pinGroup.userData.baseY ?? pinGroup.position.y;
  pinGroup.userData.baseY = baseY;

  pinGroup.userData.bouncing = true;
  const start = performance.now();
  const DURATION = 520;
  const AMP = 0.12;

  function frame(t) {
    if (!pinGroup.userData.bouncing) return;

    const p = Math.min(1, (t - start) / DURATION);
    const s = Math.sin(p * Math.PI) * (1 - p);

    pinGroup.position.y = baseY + s * AMP;

    if (p < 1) requestAnimationFrame(frame);
    else {
      pinGroup.position.y = baseY;
      pinGroup.userData.bouncing = false;
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

      out.push({
        ...s,
        pin_lat: baseLat + dLat,
        pin_lon: baseLon + dLon,
      });
    });
  }

  return out;
}

/** ---------------------------
 *  Mount
 *  -------------------------- */
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

  // Controls (very slow clockwise rotation)
  const controls = globe.controls();
  controls.enabled = true;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  controls.autoRotate = true;
  // 👇 “very very slow” clockwise; tweak smaller if needed (0.0002–0.001)
  controls.autoRotateSpeed = 0.00035;

  // Lights
  globe.scene().add(new THREE.AmbientLight(0xffffff, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(1, 1, 1);
  globe.scene().add(dir);

  // UI
  const panel = makePanel(container);
  disableBlockingOverlays(container);

  // Data
  const storiesRaw = await loadStoriesFromGoogleSheet();
  const stories = jitterDuplicatesByLatLng(storiesRaw, 0.10);

  // Template pin (we clone per story)
  const pinTemplate = makeTeardropPinSprite();

  let lastHovered = null;

  globe
    .objectsData(stories)
    .objectLat((d) => d.pin_lat)
    .objectLng((d) => d.pin_lon)

    // Tip is the anchor; altitude pushes the entire pin outward from the surface
    // Keep small to avoid floating far above exact point.
    .objectAltitude(0.01)

    .objectThreeObject((d) => {
      const pin = pinTemplate.clone(true);

      // Make it “stick out” at ~45° visually
      // (This is a local rotation; globe.gl already orients objects outward.)
      pin.rotateZ(-THREE.MathUtils.degToRad(45));

      // Store handle for hover/bounce
      d.__pin = pin;

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

  console.log("Globe mounted. Pins:", stories.length);
  return globe;
}
