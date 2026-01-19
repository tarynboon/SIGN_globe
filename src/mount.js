// src/mount.js
import Globe from "globe.gl";
import * as THREE from "three";

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

  const stories = raw
    .map((d) => {
      const latRaw = get(d, "pin_lat", "pin_lat (num)", "pin lat", "lat", "latitude");
      const lonRaw = get(d, "pin_lon", "pin_lon (num)", "pin lon", "lon", "lng", "longitude");

      return {
        id: String(get(d, "id") ?? ""),
        pin_lat: Number(latRaw),
        pin_lon: Number(lonRaw),
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
  panel.dataset.sgPanel = "1"; // ✅ so we don't disable pointer events on it

  panel.style.cssText = `
    position:absolute; right:16px; top:16px; width:min(420px, 92%);
    max-height:80%; overflow:auto; background:#fff; border-radius:12px;
    box-shadow:0 8px 24px rgba(0,0,0,.18); padding:14px;
    display:none; z-index:999999;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    pointer-events:auto;
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
      <img id="sg-img" style="width:100%;max-height:240px;object-fit:cover;border-radius:10px;display:block;" />
    </div>

    <div id="sg-body" style="margin-top:10px; line-height:1.45;"></div>
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

/**
 * Your console proved a blocking overlay DIV is sitting above the canvas.
 * This removes pointer events from absolute overlays so drag reaches the canvas.
 * We keep the story panel clickable.
 */
function disableBlockingOverlays(container) {
  let tries = 0;

  const tick = () => {
    tries++;

    // Ensure canvas can receive drag events
    const canvas = container.querySelector("canvas");
    if (canvas) {
      canvas.style.pointerEvents = "auto";
      canvas.style.touchAction = "none";
      canvas.style.cursor = "grab";
    }

    // Disable pointer events on absolute overlays (except panel)
    const overlays = Array.from(container.querySelectorAll("div")).filter((el) => {
      if (el.dataset.sgPanel === "1") return false;
      const cs = getComputedStyle(el);
      return cs.position === "absolute";
    });

    overlays.forEach((el) => {
      el.style.pointerEvents = "none";
    });

    // Keep panel clickable
    const panel = container.querySelector('[data-sg-panel="1"]');
    if (panel) panel.style.pointerEvents = "auto";

    if (tries < 40) requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}
function makePinMesh() {
  const group = new THREE.Group();

  const red = new THREE.MeshStandardMaterial({ color: 0xd32f2f });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), red);
  head.position.set(0, 0.35, 0);

  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), white);
  dot.position.set(0, 0.35, 0.14);

  const body = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 16), red);
  body.position.set(0, 0.1, 0);

  group.add(body, head, dot);

  // ✅ VISIBILITY FIX
  group.scale.set(2.5, 2.5, 2.5);
  group.lookAt(0, 0, 0);

  return group;
}

export async function mountSignGlobe({ containerId = "sign-globe", height = 650 } = {}) {
  const container = document.getElementById(containerId);
  if (!container) throw new Error(`Missing #${containerId}`);

  container.style.position = "relative";
  container.style.height = typeof height === "number" ? `${height}px` : height;
  container.style.width = "100%";
  container.style.touchAction = "none";

  // Prevent page scroll/trackpad gestures from stealing drag
  container.addEventListener(
    "wheel",
    (e) => e.preventDefault(),
    { passive: false }
  );

  const globe = Globe()(container)
    .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg")
    .backgroundColor("rgba(0,0,0,0)");

  // Enable pointer interaction (raycasting/clicks)
  if (typeof globe.enablePointerInteraction === "function") {
    globe.enablePointerInteraction(true);
  }

  // Controls: explicitly enabled
  const controls = globe.controls();
  controls.enabled = true;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Auto-rotate (still draggable)
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;

  // Lighting for pins
  globe.scene().add(new THREE.AmbientLight(0xffffff, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(1, 1, 1);
  globe.scene().add(dir);

  const panel = makePanel(container);

  // ✅ critical fix for dragging
  disableBlockingOverlays(container);

  const stories = await loadStoriesFromGoogleSheet();

  globe
    .objectsData(stories)
    .objectLat((d) => d.pin_lat)
    .objectLng((d) => d.pin_lon)
    .objectAltitude(0.12)
    .objectThreeObject(() => makePinMesh())
    .onObjectClick((d) => {
      console.log("PIN CLICK", d.id);
      panel.open(d);
    });

  console.log("Globe mounted. Pins:", stories.length);
  return globe;
}
