import Globe from "globe.gl";

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
      const latRaw = get(d, "pin_lat", "pin lat", "lat", "latitude");
      const lonRaw = get(d, "pin_lon", "pin lon", "lon", "lng", "longitude");

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

  // ✅ tag so we can avoid disabling pointer events on it
  panel.dataset.sgPanel = "1";

  panel.style.cssText = `
    position:absolute; right:16px; top:16px; width:min(420px, 92%);
    max-height:80%; overflow:auto; background:#fff; border-radius:12px;
    box-shadow:0 8px 24px rgba(0,0,0,.18); padding:14px;
    display:none; z-index:999999;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  `;
  panel.style.pointerEvents = "auto";

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
 * Key trick:
 * - Set globe.gl overlay container pointer-events to NONE so dragging works
 * - Keep pins pointer-events to AUTO so pins are clickable
 * - DO NOT touch our story panel (it's absolute-positioned too)
 */
function fixOverlayPointerEvents(container) {
  let tries = 0;

  const tick = () => {
    tries++;

    const absDivs = Array.from(container.querySelectorAll("div")).filter((el) => {
      if (el.dataset.sgPanel === "1") return false; // ✅ don't disable popup panel
      const cs = getComputedStyle(el);
      return cs.position === "absolute";
    });

    // Make overlays transparent to mouse (so globe drag works)
    absDivs.forEach((el) => {
      el.style.pointerEvents = "none";
    });

    if (tries < 20) requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

export async function mountSignGlobe({ containerId = "sign-globe", height = 650 } = {}) {
  const container = document.getElementById(containerId);
  if (!container) throw new Error(`Missing #${containerId}`);

  container.style.position = "relative";
  container.style.height = typeof height === "number" ? `${height}px` : height;
  container.style.width = "100%";

  const globe = Globe()(container)
    .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg")
    .backgroundColor("rgba(0,0,0,0)");

  // ✅ Make it rotatable/draggable (explicit)
  const controls = globe.controls();
  controls.enabled = true;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // optional: slow auto-rotate
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;

  const panel = makePanel(container);

  fixOverlayPointerEvents(container);

  // ✅ Load from Google Sheet
  const stories = await loadStoriesFromGoogleSheet();

  globe
    .htmlElementsData(stories)
    .htmlLat((d) => d.pin_lat)
    .htmlLng((d) => d.pin_lon)
    .htmlElement((d) => {
      const pin = document.createElement("div");

      // ✅ teardrop pin
      pin.style.cssText = `
        width:22px;
        height:22px;
        background:#d32f2f;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        cursor:pointer;
        position:relative;
        z-index:99999;
        pointer-events:auto;
        box-shadow: 0 3px 6px rgba(0,0,0,0.4);
      `;

      const inner = document.createElement("div");
      inner.style.cssText = `
        width:10px;
        height:10px;
        background:white;
        border-radius:50%;
        position:absolute;
        top:6px;
        left:6px;
        pointer-events:none;
      `;
      pin.appendChild(inner);

      pin.title = d.pin_label || d.title || "";

      // ✅ prevent click from becoming a drag
      pin.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
      });

      pin.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("PIN CLICK", d.id);
        panel.open(d);
      });

      return pin;
    });

  console.log("Globe mounted. Pins:", stories.length);
  return globe;
}
