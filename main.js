const FONT_SIZE = 12;
const FONT_FAMILY = "Helvetica, Arial, sans-serif";
const DOT_RADIUS = 4;
const MIN_STEM = 20; // minimum stem height (level 0)
const LEVEL_HEIGHT = 30; // vertical spacing per collision level
const LABEL_H_PAD = 6; // horizontal padding between tags for collision check
const TAG_PAD_X = 7; // horizontal padding inside tag
const TAG_PAD_Y = 4; // vertical padding inside tag
const TAG_H = FONT_SIZE + TAG_PAD_Y * 2; // tag height
const H_PADDING = 60; // left/right margin for dot placement
let categoryPalette = [
  "#efefef",
  "#ffe438",
  "#ff4c4c",
  "#000000",
];
const EDGE_MARGIN = 16; // minimum gap between any tag and the container edge
const BOTTOM_MARGIN = 48; // space below the timeline for year labels
const TOP_MARGIN = 16; // space above topmost label

let events = [];
let categoryColors = {};

function rebuildCategoryColors() {
  categoryColors = {};
  let colorIdx = 0;
  for (const e of events) {
    if (e.category && !(e.category in categoryColors)) {
      categoryColors[e.category] = categoryPalette[colorIdx++ % categoryPalette.length];
    }
  }
}

// Persistent off-screen span for text measurement
const measureSpan = document.createElement("span");
measureSpan.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;top:-9999px;white-space:nowrap;font-size:${FONT_SIZE}px;font-family:${FONT_FAMILY}`;
document.body.appendChild(measureSpan);

// --- CSV parsing ---

function parseCSV(text) {
  const result = [];
  for (const rawLine of text.trim().split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const commaIdx = line.indexOf(",");
    if (commaIdx === -1) continue;
    const dateStr = line.slice(0, commaIdx).trim();
    const rest = line.slice(commaIdx + 1);
    const commaIdx2 = rest.indexOf(",");
    const rawName = (commaIdx2 === -1 ? rest : rest.slice(0, commaIdx2)).trim();
    const name = rawName.replace(/^"|"$/g, "").replace(/""/g, '"');
    const category =
      commaIdx2 === -1 ? null : rest.slice(commaIdx2 + 1).trim() || null;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) continue; // skip header / bad rows
    result.push({ date, name, category });
  }
  return result.sort((a, b) => a.date - b.date);
}

// --- Level assignment (greedy interval scheduling) ---

function assignLevels(items) {
  // items must have .tagX and .tagW set
  const sorted = [...items].sort((a, b) => a.tagX - b.tagX);
  const levelRight = []; // rightmost occupied x per level

  for (const item of sorted) {
    const lx = item.tagX - LABEL_H_PAD;
    const rx = item.tagX + item.tagW + LABEL_H_PAD;

    let level = -1;
    for (let i = 0; i < levelRight.length; i++) {
      if (levelRight[i] <= lx) {
        level = i;
        levelRight[i] = rx;
        break;
      }
    }
    if (level === -1) {
      level = levelRight.length;
      levelRight.push(rx);
    }
    item.level = level;
  }
}

// --- Helpers ---

function parseCssColor(color) {
  // Returns [r, g, b] 0-255 from a hex color string
  const h = color.trim().slice(1);
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relativeLuminance(color) {
  const [r, g, b] = parseCssColor(color).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function labelColor(bgColor) {
  return relativeLuminance(bgColor) > 0.3 ? "black" : "white";
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function measureWidths(names) {
  return names.map((name) => {
    measureSpan.textContent = name;
    return measureSpan.offsetWidth;
  });
}

function dateToX(date, startDate, pxPerMs) {
  return H_PADDING + (date - startDate) * pxPerMs;
}

// --- Layout computation (no DOM writes) ---

function computeLayout(viewW, viewH, headerHeight, showToday) {
  const minDate = events[0].date;
  const maxDate = events[events.length - 1].date;

  const startDate = new Date(0);
  startDate.setFullYear(minDate.getFullYear(), 0, 1);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(0);
  endDate.setFullYear(maxDate.getFullYear() + 1, 0, 1);
  endDate.setHours(0, 0, 0, 0);
  const totalMs = endDate - startDate;

  const pxPerMs = (viewW - H_PADDING * 2) / totalMs;
  const totalW = viewW;

  const pxPerYear = pxPerMs * 365.25 * 24 * 60 * 60 * 1000;
  const BAND_STEPS = [1, 2, 5, 10, 25, 50, 100, 200, 500];
  const bandYears = BAND_STEPS.find((s) => s * pxPerYear >= 80) || 500;
  const showYearInLabel = bandYears > 1;

  const baseYear = startDate.getFullYear();

  // Assign sides by balancing count — avoids clustering all events in one year on one side
  let aboveCount = 0,
    belowCount = 0;
  function nextSide() {
    if (aboveCount <= belowCount) {
      aboveCount++;
      return "above";
    }
    belowCount++;
    return "below";
  }

  const items = events.map((e) => ({
    date: e.date,
    name: e.name,
    category: e.category,
    displayName: showYearInLabel ? `${e.date.getFullYear()} ${e.name}` : e.name,
    x: dateToX(e.date, startDate, pxPerMs),
    side: nextSide(),
    width: 0,
    level: 0,
  }));

  if (showToday) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    items.push({
      date: today,
      name: "Today",
      displayName: "Today",
      x: dateToX(today, startDate, pxPerMs),
      side: nextSide(),
      width: 0,
      level: 0,
    });
  }

  const widths = showYearInLabel ? null : measureWidths(items.map((i) => i.displayName));
  items.forEach((item, i) => {
    if (showYearInLabel) {
      measureSpan.innerHTML = `<strong>${item.date.getFullYear()} </strong>${item.name}`;
      item.width = measureSpan.offsetWidth;
    } else {
      item.width = widths[i];
    }
    item.tagW = item.width + TAG_PAD_X * 2;
    item.tagX = Math.max(
      EDGE_MARGIN,
      Math.min(totalW - item.tagW - EDGE_MARGIN, item.x - item.tagW / 2),
    );
  });

  const aboveItems = items.filter((i) => i.side === "above");
  const belowItems = items.filter((i) => i.side === "below");
  assignLevels(aboveItems);
  assignLevels(belowItems);

  const maxAbove = aboveItems.reduce((m, i) => Math.max(m, i.level), 0);
  const maxBelow = belowItems.reduce((m, i) => Math.max(m, i.level), -1);

  const aboveHeight = TOP_MARGIN + TAG_H + maxAbove * LEVEL_HEIGHT + MIN_STEM;
  const belowHeight =
    (maxBelow >= 0 ? MIN_STEM + maxBelow * LEVEL_HEIGHT + TAG_H : 0) +
    BOTTOM_MARGIN;

  const idealTimelineY = (window.innerHeight - headerHeight) / 2;
  const timelineY = Math.max(
    aboveHeight + DOT_RADIUS,
    Math.min(idealTimelineY, viewH - DOT_RADIUS - belowHeight),
  );

  const rendered = items.map((item) => {
    const above = item.side === "above";
    const stemEnd = above
      ? timelineY - DOT_RADIUS - MIN_STEM - item.level * LEVEL_HEIGHT
      : timelineY + DOT_RADIUS + MIN_STEM + item.level * LEVEL_HEIGHT;
    return {
      item,
      above,
      stemEnd,
      tagW: item.tagW,
      tagX: item.tagX,
      tagY: above ? stemEnd - TAG_H : stemEnd,
    };
  });

  return {
    rendered,
    totalW,
    totalH: viewH,
    timelineY,
    startYear: baseYear,
    endYear: endDate.getFullYear(),
    startDate,
    pxPerMs,
    bandYears,
    showYearInLabel,
  };
}

// --- Main render (SVG construction) ---

function render() {
  const container = document.getElementById("timeline");
  const wrapper = document.getElementById("timeline-wrapper");
  const empty = document.getElementById("empty-state");

  if (!events.length) {
    container.style.display = "none";
    empty.style.display = "flex";
    return;
  }

  container.style.display = "block";
  empty.style.display = "none";

  const headerHeight = document.querySelector(".controls").offsetHeight;
  const {
    rendered,
    totalW,
    totalH,
    timelineY,
    startYear,
    endYear,
    startDate,
    pxPerMs,
    bandYears,
    showYearInLabel,
  } = computeLayout(wrapper.clientWidth, wrapper.clientHeight, headerHeight, document.getElementById("today-toggle").checked);

  const svg = svgEl("svg", {
    width: totalW,
    height: totalH,
    viewBox: `0 0 ${totalW} ${totalH}`,
  });

  // Layer groups — columns < ticks < events < year labels
  const yearGroup = svgEl("g");
  const eventGroup = svgEl("g");
  const labelGroup = svgEl("g");
  svg.appendChild(yearGroup);
  svg.appendChild(eventGroup);
  svg.appendChild(labelGroup);

  // Year background columns
  const colStart = Math.floor(startYear / bandYears) * bandYears;
  for (let y = colStart, idx = 0; y < endYear; y += bandYears, idx++) {
    const _d1 = new Date(0);
    _d1.setFullYear(y, 0, 1);
    _d1.setHours(0, 0, 0, 0);
    const _d2 = new Date(0);
    _d2.setFullYear(y + bandYears, 0, 1);
    _d2.setHours(0, 0, 0, 0);
    const x1 = dateToX(_d1, startDate, pxPerMs);
    const x2 = dateToX(_d2, startDate, pxPerMs);
    yearGroup.appendChild(
      svgEl("rect", {
        x: x1,
        y: 0,
        width: x2 - x1,
        height: totalH,
        fill: idx % 2 === 0 ? "white" : "#f8f8f8",
      }),
    );
  }

  // Year ticks and labels
  const tickStart = Math.ceil(startYear / bandYears) * bandYears;
  for (let y = tickStart; y <= endYear; y += bandYears) {
    const _d = new Date(0);
    _d.setFullYear(y, 0, 1);
    _d.setHours(0, 0, 0, 0);
    const x = dateToX(_d, startDate, pxPerMs);
    if (x < 0 || x > totalW) continue;

    yearGroup.appendChild(
      svgEl("line", {
        x1: x,
        y1: timelineY,
        x2: x,
        y2: timelineY + 7,
        stroke: "black",
        "stroke-width": 1,
      }),
    );

    const lbl = svgEl("text", {
      x,
      y: timelineY + 20,
      "text-anchor": "middle",
      "font-size": 11,
      "font-family": FONT_FAMILY,
      fill: "black",
      stroke: "white",
      "stroke-width": 4,
      "paint-order": "stroke fill",
    });
    lbl.textContent = String(y);
    labelGroup.appendChild(lbl);
  }

  // Baseline
  yearGroup.appendChild(
    svgEl("line", {
      x1: 0,
      y1: timelineY,
      x2: totalW,
      y2: timelineY,
      stroke: "black",
      "stroke-width": 1.5,
    }),
  );

  // Stems and dots
  for (const { item, above, stemEnd } of rendered) {
    const stemTop = above ? stemEnd : timelineY + DOT_RADIUS;
    const stemBottom = above ? timelineY - DOT_RADIUS : stemEnd;
    eventGroup.appendChild(
      svgEl("line", {
        x1: item.x,
        y1: stemTop,
        x2: item.x,
        y2: stemBottom,
        stroke: "black",
        "stroke-width": 1,
      }),
    );
    eventGroup.appendChild(
      svgEl("circle", {
        cx: item.x,
        cy: timelineY,
        r: DOT_RADIUS,
        fill: "black",
      }),
    );
  }

  // Tags
  for (const { item, tagW, tagX, tagY } of rendered) {
    const color = categoryColors[item.category];
    eventGroup.appendChild(
      svgEl("rect", {
        x: tagX,
        y: tagY,
        width: tagW,
        height: TAG_H,
        rx: 4,
        fill: color || "white",
        stroke: "black",
        "stroke-width": 1,
      }),
    );

    const txt = svgEl("text", {
      x: tagX + tagW / 2,
      y: tagY + TAG_H / 2,
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "font-size": FONT_SIZE,
      "font-family": FONT_FAMILY,
      fill: labelColor(color || "#ffffff"),
    });
    if (showYearInLabel) {
      const ts1 = svgEl("tspan", { "font-weight": "bold" });
      ts1.textContent = item.date.getFullYear() + " ";
      txt.appendChild(ts1);
      const ts2 = svgEl("tspan");
      ts2.textContent = item.name;
      txt.appendChild(ts2);
    } else {
      txt.textContent = item.name;
    }
    eventGroup.appendChild(txt);
  }

  container.innerHTML = "";
  container.appendChild(svg);
}

// --- Palette persistence ---

function savePalette() {
  localStorage.setItem("timeline-palette", JSON.stringify(categoryPalette));
}

const savedPalette = localStorage.getItem("timeline-palette");
if (savedPalette) {
  try { categoryPalette = JSON.parse(savedPalette); } catch {}
}

// --- Palette UI ---

function renderPalette() {
  const container = document.getElementById("palette-swatches");
  container.innerHTML = "";

  categoryPalette.forEach((color, idx) => {
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = color;

    const removeBtn = document.createElement("button");
    removeBtn.className = "swatch-remove";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      categoryPalette.splice(idx, 1);
      savePalette();
      rebuildCategoryColors();
      renderPalette();
      render();
    });
    swatch.appendChild(removeBtn);

    const input = document.createElement("input");
    input.type = "color";
    input.value = color;
    input.style.cssText =
      "position:absolute;opacity:0;width:0;height:0;pointer-events:none;";
    input.addEventListener("input", (e) => {
      categoryPalette[idx] = e.target.value;
      swatch.style.background = e.target.value;
      savePalette();
      rebuildCategoryColors();
      render();
    });
    swatch.appendChild(input);

    swatch.addEventListener("click", () => input.click());
    container.appendChild(swatch);
  });

  const addBtn = document.createElement("button");
  addBtn.className = "swatch-add";
  addBtn.textContent = "+";
  addBtn.addEventListener("click", () => {
    categoryPalette.push("#cccccc");
    savePalette();
    rebuildCategoryColors();
    renderPalette();
    render();
  });
  container.appendChild(addBtn);
}

renderPalette();

// --- Event listeners ---

document.getElementById("today-toggle").addEventListener("change", render);

document.getElementById("upload-btn").addEventListener("click", () => {
  document.getElementById("upload-input").click();
});

document.getElementById("upload-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    localStorage.setItem("timeline-csv", text);
    events = parseCSV(text);
    rebuildCategoryColors();
    render();
  };
  reader.readAsText(file);
  e.target.value = "";
});

const saved = localStorage.getItem("timeline-csv");
if (saved) {
  events = parseCSV(saved);
  rebuildCategoryColors();
  render();
}

const EXAMPLE_CSV = `date,name,category
1903-12-17,Wright Brothers first powered flight,aviation
1927-05-21,Lindbergh completes first solo transatlantic flight,aviation
1947-10-14,Chuck Yeager breaks the sound barrier,aviation
1957-10-04,Sputnik 1 - first artificial satellite launched,space
1961-04-12,Yuri Gagarin becomes first human in space,space
1963-06-16,Valentina Tereshkova first woman in space,space
1969-07-20,Apollo 11 - first Moon landing,space
1971-04-19,Salyut 1 - first space station,space
1976-07-20,Viking 1 lands on Mars,space
1990-04-24,Hubble Space Telescope deployed,space
1993-12-02,Hubble repaired by Space Shuttle crew,space
2004-01-03,Spirit rover lands on Mars,space
2012-08-06,Curiosity rover lands on Mars,space
2015-07-14,New Horizons flyby of Pluto,space
2021-04-19,Ingenuity helicopter first powered flight on Mars,aviation
2022-12-11,Artemis I completes lunar flyby,space
`;

document.getElementById("example-btn").addEventListener("click", () => {
  const blob = new Blob([EXAMPLE_CSV], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "example.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("export-btn").addEventListener("click", () => {
  const svg = document.querySelector("#timeline svg");
  if (!svg) return;
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
    type: "image/svg+xml",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "timeline.svg";
  a.click();
  URL.revokeObjectURL(a.href);
});


let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (events.length) render();
  }, 100);
});
