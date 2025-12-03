import Globe from "globe.gl";

console.log("MAIN.JS LOADED", new Date().toISOString());

async function loadStories(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load stories: ${res.status}`);
  return res.json();
}

function makePanel(container) {
  const panel = document.createElement("div");
  panel.style.cssText = `
    position:absolute; right:16px; top:16px; width:min(420px, 92%);
    max-height:80%; overflow:auto; background:#fff; border-radius:12px;
    box-shadow:0 8px 24px rgba(0,0,0,.18); padding:14px;
    display:none; z-index:9999;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  `;

  // Start non-blocking until opened
  panel.style.pointerEvents = "none";

  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; gap:12px;">
      <div>
        <div id="sg-title" style="font-weight:700; font-size:16px;"></div>
        <div id="sg-meta" style="opacity:.7; font-size:13px; margin-top:2px;"></div>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="sg-min" style="cursor:pointer;">–</button>
        <button id="sg-close" style="cursor:pointer;">×</button>
      </div>
    </div>
    <div id="sg-body" style="margin-top:10px; line-height:1.45;"></div>
    <div style="margin-top:10px;">
      <a id="sg-src" href="#" target="_blank" rel="noopener">Read on SIGN</a>
    </div>
  `;

  container.appendChild(panel);

  const titleEl = panel.querySelector("#sg-title");
  const metaEl = panel.querySelector("#sg-meta");
  const bodyEl = panel.querySelector("#sg-body");
  const srcEl = panel.querySelector("#sg-src");

  panel.querySelector("#sg-close").onclick = () => {
    panel.style.display = "none";
    panel.style.pointerEvents = "none"; // allow globe drag again
  };

  panel.querySelector("#sg-min").onclick = () => {
    const minimized = panel.dataset.min === "1";
    panel.dataset.min = minimized ? "0" : "1";

    bodyEl.style.display = minimized ? "block" : "none";
    srcEl.style.display = minimized ? "inline" : "none";

    if (!minimized) {
      // minimize
      panel.style.width = "220px";
      panel.style.maxHeight = "60px";
    } else {
      // restore
      panel.style.width = "min(420px, 92%)";
      panel.style.maxHeight = "80%";
    }

    // Keep buttons clickable; small footprint so it won't block much
    panel.style.pointerEvents = "auto";
  };

  return {
    open(story) {
      titleEl.textContent = story.title || "";
      metaEl.textContent = story.country || "";
      bodyEl.innerHTML = story.story_html || "";
      srcEl.href =
        story.source_url || "https://www.signfracturecare.org/patient-gallery";

      // Always open in full mode
      panel.dataset.min = "0";
      panel.style.width = "min(420px, 92%)";
      panel.style.maxHeight = "80%";
      bodyEl.style.display = "block";
      srcEl.style.display = "inline";

      panel.style.display = "block";
      panel.style.pointerEvents = "auto";
    },
  };
}

async function main() {
  document.querySelector("#app").innerHTML = `
    <div id="sign-globe" style="width:100%; height:650px; position:relative;"></div>
  `;

  const container = document.getElementById("sign-globe");
  container.style.position = "relative";

  const globe = Globe()(container)
    .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg")
    .backgroundColor("rgba(0,0,0,0)");

  // Ensure canvas stays behind overlays visually
  const canvas = container.querySelector("canvas");
  if (canvas) {
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.zIndex = "0";
    canvas.style.pointerEvents = "auto"; // keep globe drag/zoom working
  }

  // Panel after globe/canvas
  const panel = makePanel(container);

  const data = await loadStories("/stories.json");

  globe
    .htmlElementsData(data.stories)
    .htmlLat((d) => d.pin_lat)
    .htmlLng((d) => d.pin_lon)
    .htmlElement((d) => {
      const el = document.createElement("div");
      el.style.width = "14px";
      el.style.height = "14px";
      el.style.borderRadius = "50%";
      el.style.background = "#d32f2f"; // SIGN red
      el.style.boxShadow = "0 0 8px rgba(0,0,0,0.6)";
      el.style.cursor = "pointer";
      el.style.position = "relative";
      el.style.zIndex = "50";
      el.style.pointerEvents = "auto"; // critical for clickability
      el.title = d.pin_label; // hover tooltip

      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        panel.open(d);
        globe.pointOfView(
          { lat: d.pin_lat, lng: d.pin_lon, altitude: 1.4 },
          900
        );
      });

      return el;
    });
}

main().catch((e) => {
  console.error(e);
  alert(e.message);
});
