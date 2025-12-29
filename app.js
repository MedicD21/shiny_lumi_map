/*
 * Lumiose City Interactive Map Editor
 * Leaflet (CRS.Simple) powered, single-page vanilla JS app.
 * Uses one App module to avoid polluting globals.
 */

// Shiny circles defined by diameter in game units (50u inner, 70u outer)
const SHINY_DIAMETERS_UNITS = [50, 70];
const FIXED_PIXELS_PER_UNIT = 3.2689; // locked scale for ZA_Lumiose_City_Night.png
const STICKER_LIST_PATH = "assets/icons/pkmn_stickers/stickers.json";

const App = (() => {
  "use strict";

  const STORAGE_KEY = "lumiose-map-state-v1";
  const DEFAULT_IMAGE = "ZA_Lumiose_City_Night.png";
  const FALLBACK_IMAGE = "map.png";
  const ICONS = {
    bench: "assets/icons/icon_bench.png",
    ladder: "assets/icons/icon_ladder.png",
    elevator: "assets/icons/icon_arrow.png",
  };
  const BASE_ICON_SIZES = {
    bench: 28,
    ladder: 28,
    elevator: 28,
    circle: 18,
    sprite: 50,
    shiny: 18,
  };

  const state = {
    map: null,
    overlay: null,
    bounds: null,
    image: { url: "", width: 0, height: 0 },
    pixelsPerUnit: FIXED_PIXELS_PER_UNIT,
    layers: null,
    visibility: {
      presets: true,
      users: true,
      benches: true,
      ladders: true,
      elevators: true,
      circles: true,
      zones: true,
    },
    snap: true,
    gridSize: 1,
    addMode: false,
    editMode: false,
    deleteMode: false,
    measureMode: false,
    currentTool: null,
    currentLabel: "",
    currentColor: "#4fc3f7",
    currentSticker: "",
    data: {
      presetMarkers: [],
      userMarkers: [],
      originalPresets: [],
      zones: [],
      customMarkers: [],
    },
    stickers: [],
    markersIndex: new Map(), // id -> {layer, data}
    selection: null,
    measure: {
      origin: null,
      target: null,
      line: null,
      popup: null,
      group: null,
      lastTarget: null,
    },
    shiny: {
      layer: null,
      marker: null,
      rings: [],
      center: null,
      visible: [true, true],
    },
    zonesLayer: null,
    zoneDrawing: {
      active: false,
      points: [],
      tempLine: null,
      tempPolygon: null,
    },
    pendingSave: null,
    persisted: null,
  };

  const dom = {};
  let objectUrl = null;

  /* Utility helpers */
  const uuid = (prefix = "m") =>
    `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

  const debounce = (fn, wait = 150) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

  const getStickerPath = (name) =>
    name ? `assets/icons/pkmn_stickers/${name}` : "";

  const formatStickerLabel = (name) => {
    if (!name) return "Sticker marker";
    const trimmed = name.replace(".png", "").replace(/[-_]/g, " ");
    const words = trimmed.split(" ").filter(Boolean);
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  };

  const toUnits = (value) => Number.parseFloat(value) || 0;

  const formatDistance = (latlngA, latlngB) => {
    const dx = latlngB.lng - latlngA.lng;
    const dy = latlngB.lat - latlngA.lat;
    const pixels = Math.hypot(dx, dy);
    const units = pixels / state.pixelsPerUnit;
    return { units: units.toFixed(2), pixels: pixels.toFixed(1) };
  };

  const getZoomScale = () => {
    if (!state.map) return 1;
    const zoom = state.map.getZoom() ?? 0;
    const scale = Math.pow(2, zoom);
    return Math.min(Math.max(scale, 0.35), 3);
  };

  const updateIconScales = () => {
    const factor = getZoomScale();
    state.markersIndex.forEach(({ data, marker }) => {
      const el = marker?.getElement();
      if (!el) return;
      const base = BASE_ICON_SIZES[data.type] || BASE_ICON_SIZES.bench;
      const size = base * factor;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      if (data.type === "circle") {
        el.style.borderRadius = "50%";
        el.style.background = data.color || state.currentColor;
      } else if (data.type === "sprite") {
        el.style.backgroundImage = `url(${getStickerPath(data.sprite)})`;
        el.style.backgroundSize = "contain";
        el.style.backgroundRepeat = "no-repeat";
        el.style.backgroundColor = "transparent";
      } else if (data.type === "shiny") {
        el.style.backgroundImage = "";
      } else {
        el.style.backgroundImage = `url(${ICONS[data.type] || ICONS.bench})`;
      }
    });
    const shinyEl = state.shiny.marker?.getElement?.();
    if (shinyEl) {
      const base = BASE_ICON_SIZES.shiny;
      const size = base * factor;
      shinyEl.style.width = `${size}px`;
      shinyEl.style.height = `${size}px`;
    }
  };

  /* Initialization */
  const init = async () => {
    cacheDom();
    guardPanelEvents();
    bindUI();
    await loadStickers();
    updateDeleteButtonVisibility();
    loadPersisted();
    await loadInitialImage();
    await loadMarkers();
    closeResetModal();
    ensureShinyRadius();
    syncShinyRingButtons();
  };

  const cacheDom = () => {
    dom.mapEl = document.getElementById("map");
    dom.panel = document.getElementById("control-panel");
    dom.panelHeader = dom.panel.querySelector(".panel-header");
    dom.panelToggle = document.getElementById("panel-toggle");
    dom.imageMeta = document.getElementById("image-meta");
    dom.ppuReadout = document.getElementById("ppu-readout");
    dom.measurePixels = document.getElementById("measure-pixels");
    dom.measureUnits = document.getElementById("measure-units");
    dom.shinyRecenter = document.getElementById("shiny-recenter");
    dom.toggleRing50 = document.getElementById("toggle-ring-50");
    dom.toggleRing70 = document.getElementById("toggle-ring-70");
    dom.measureBtn = document.getElementById("measure-mode");
    dom.addBtn = document.getElementById("add-mode");
    dom.editBtn = document.getElementById("edit-mode");
    dom.deleteBtn = document.getElementById("delete-mode");
    dom.zoneBtn = document.getElementById("zone-mode");
    dom.markerLabel = document.getElementById("marker-label");
    dom.typeCircle = document.getElementById("type-circle");
    dom.typeSprite = document.getElementById("type-sprite");
    dom.markerColor = document.getElementById("marker-color");
    dom.stickerSelect = document.getElementById("sticker-select");
    dom.zoneLabel = document.getElementById("zone-label");
    dom.zoneNumber = document.getElementById("zone-number");
    dom.toggleUsers = document.getElementById("toggle-users");
    dom.layerBenches = document.getElementById("layer-benches");
    dom.layerLadders = document.getElementById("layer-ladders");
    dom.layerElevators = document.getElementById("layer-elevators");
    dom.layerZones = document.getElementById("layer-zones");
    dom.snapToggle = document.getElementById("snap-toggle");
    dom.gridSize = document.getElementById("grid-size");
    dom.downloadAll = document.getElementById("download-all");
    dom.downloadPresets = document.getElementById("download-presets");
    dom.downloadUsers = document.getElementById("download-users");
    dom.copyJson = document.getElementById("copy-json");
    dom.importUsers = document.getElementById("import-users");
    dom.importUsersFile = document.getElementById("import-users-file");
    dom.resetBtn = document.getElementById("reset-btn");
    dom.resetModal = document.getElementById("reset-modal");
    dom.confirmReset = document.getElementById("confirm-reset");
    dom.cancelReset = document.getElementById("cancel-reset");
    dom.resetClose = document.getElementById("reset-close");
    dom.inspectorLabel = document.getElementById("inspector-label");
    dom.inspectorType = document.getElementById("inspector-type");
    dom.inspectorColor = document.getElementById("inspector-color");
    dom.inspectorSticker = document.getElementById("inspector-sticker");
    dom.applyInspector = document.getElementById("apply-inspector");
  };

  const guardPanelEvents = () => {
    const blockEvents = (e) => e.stopPropagation();
    ["click", "mousedown", "dblclick", "wheel", "touchstart"].forEach((evt) => {
      dom.panel.addEventListener(evt, blockEvents);
    });
  };

  const bindUI = () => {
    dom.panelToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel();
    });
    if (dom.panelHeader) {
      dom.panelHeader.addEventListener("click", () => {
        if (dom.panel.classList.contains("collapsed")) togglePanel();
      });
    }
    dom.shinyRecenter.addEventListener("click", recenterShiny);
    dom.toggleRing50?.addEventListener("click", () =>
      toggleShinyRing(0, dom.toggleRing50)
    );
    dom.toggleRing70?.addEventListener("click", () =>
      toggleShinyRing(1, dom.toggleRing70)
    );

    dom.measureBtn.addEventListener("click", () =>
      setMeasureMode(!state.measureMode)
    );
    dom.addBtn.addEventListener("click", () => setAddMode(!state.addMode));
    dom.editBtn.addEventListener("click", () => setEditMode(!state.editMode));
    dom.deleteBtn.addEventListener("click", () =>
      setDeleteMode(!state.deleteMode)
    );
    dom.zoneBtn.addEventListener("click", () =>
      setZoneMode(!state.zoneDrawing.active)
    );

    dom.typeCircle?.addEventListener("click", (e) => {
      e.preventDefault();
      setCurrentTool("circle");
    });
    dom.typeSprite?.addEventListener("click", (e) => {
      e.preventDefault();
      setCurrentTool("sprite");
    });
    dom.markerColor.addEventListener(
      "change",
      (e) => (state.currentColor = e.target.value)
    );
    dom.stickerSelect.addEventListener("change", (e) => {
      state.currentSticker = e.target.value;
    });
    dom.inspectorType.addEventListener("change", (e) =>
      updateInspectorStickerVisibility(e.target.value)
    );

    dom.toggleUsers.addEventListener("click", () =>
      toggleLayer("users", dom.toggleUsers)
    );
    dom.layerBenches.addEventListener("click", () =>
      toggleLayer("benches", dom.layerBenches)
    );
    dom.layerLadders.addEventListener("click", () =>
      toggleLayer("ladders", dom.layerLadders)
    );
    dom.layerElevators.addEventListener("click", () =>
      toggleLayer("elevators", dom.layerElevators)
    );
    dom.layerZones.addEventListener("click", () =>
      toggleLayer("zones", dom.layerZones)
    );

    dom.snapToggle.addEventListener("change", () => {
      state.snap = dom.snapToggle.checked;
      persist();
    });
    dom.gridSize.addEventListener("change", () => {
      state.gridSize = parseFloat(dom.gridSize.value);
      persist();
    });

    dom.downloadAll.addEventListener("click", () => downloadMarkers("all"));
    dom.downloadPresets.addEventListener("click", () =>
      downloadMarkers("preset")
    );
    dom.downloadUsers.addEventListener("click", () => downloadMarkers("user"));
    dom.copyJson.addEventListener("click", () => copyMarkers());
    dom.importUsers?.addEventListener("click", () =>
      dom.importUsersFile?.click()
    );
    dom.importUsersFile?.addEventListener("change", handleImportUsers);

    dom.resetBtn.addEventListener("click", openResetModal);
    dom.cancelReset.addEventListener("click", closeResetModal);
    dom.confirmReset.addEventListener("click", handleReset);
    dom.resetClose.addEventListener("click", closeResetModal);
    dom.resetModal.addEventListener("click", (e) => {
      if (e.target === dom.resetModal) closeResetModal();
    });

    dom.applyInspector.addEventListener("click", applyInspectorEdits);

    window.addEventListener("keydown", handleShortcuts);
  };

  const loadStickers = async () => {
    try {
      const res = await fetch(STICKER_LIST_PATH);
      const list = await res.json();
      state.stickers = Array.isArray(list)
        ? list.slice().sort((a, b) => a.localeCompare(b))
        : [];
    } catch (err) {
      console.warn("Failed to load sticker list", err);
      state.stickers = [];
    }
    populateStickerSelect(dom.stickerSelect, state.stickers);
    populateStickerSelect(dom.inspectorSticker, state.stickers);
    if (state.stickers.length) {
      state.currentSticker = state.currentSticker || state.stickers[0];
      dom.stickerSelect.value = state.currentSticker;
    }
    updateAddStickerVisibility();
    updateInspectorStickerVisibility(dom.inspectorType.value);
    setCurrentTool(state.currentTool);
  };

  const populateStickerSelect = (selectEl, items) => {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    items.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name.replace(".shiny.png", "").replace(/[-_]/g, " ");
      selectEl.appendChild(opt);
    });
  };

  /* Image loading */
  const loadInitialImage = async () => {
    try {
      await loadImagePath(DEFAULT_IMAGE, true);
    } catch (err) {
      console.warn("Primary image failed, trying fallback", err);
      if (DEFAULT_IMAGE !== FALLBACK_IMAGE) {
        await loadImagePath(FALLBACK_IMAGE, true);
      }
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadImageFromFile(file);
  };

  const loadImageFromFile = async (file) => {
    return; // file uploads disabled in locked mode
  };

  const loadImagePath = async (path, silent = false) => {
    if (!path) path = DEFAULT_IMAGE;
    try {
      await applyImageSource(path, path);
    } catch (err) {
      if (!silent) alert("Failed to load image at " + path);
      throw err;
    }
  };

  const applyImageSource = (src, label) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        state.image = {
          url: src,
          width: img.naturalWidth,
          height: img.naturalHeight,
        };
        dom.imageMeta.textContent = `Map locked: ${label} — ${img.naturalWidth} x ${img.naturalHeight}px @ ${FIXED_PIXELS_PER_UNIT} px/unit`;
        if (dom.ppuReadout) dom.ppuReadout.textContent = FIXED_PIXELS_PER_UNIT;
        setupMap();
        persist();
        resolve();
      };
      img.onerror = () => reject(new Error("Image load error"));
      img.src = src;
    });
  };

  /* Map and layers */
  const setupMap = () => {
    const { width, height } = state.image;
    if (!width || !height) return;
    const widthUnits = width;
    const heightUnits = height;
    state.bounds = [
      [0, 0],
      [heightUnits, widthUnits],
    ];

    if (!state.map) {
      state.map = L.map("map", {
        crs: L.CRS.Simple,
        minZoom: -6,
        maxZoom: 6,
        zoomSnap: 0.1,
        attributionControl: false,
      });
      state.map.on("click", handleMapClick);
      state.map.on("zoomend", updateIconScales);
      initLayers();
      initMeasureTools();
    }

    if (state.overlay) state.overlay.remove();
    state.overlay = L.imageOverlay(state.image.url, state.bounds).addTo(
      state.map
    );
    state.map.setMaxBounds(L.latLngBounds(state.bounds).pad(0.25));
    recalcZoomLimits();
    state.map.fitBounds(state.bounds);
    recalcZoomLimits();
    ensureShinyRadius();
    refreshLayerVisibility();
    renderAllMarkers();
    updateIconScales();
    setTimeout(() => state.map.invalidateSize(), 50);
  };

  const updateOverlay = () => {
    if (!state.overlay) return;
    const widthUnits = state.image.width;
    const heightUnits = state.image.height;
    state.bounds = [
      [0, 0],
      [heightUnits, widthUnits],
    ];
    state.overlay.setBounds(state.bounds);
    state.map.setMaxBounds(L.latLngBounds(state.bounds).pad(0.5));
    recalcZoomLimits();
    state.map.fitBounds(state.bounds);
    recalcZoomLimits();
    ensureShinyRadius();
  };

  const ensureShinyRadius = () => {
    if (!state.map) return;
    const center = state.shiny.center || state.map.getCenter();
    createOrUpdateShiny(center);
  };

  const recalcZoomLimits = () => {
    if (!state.map || !state.bounds) return;
    const fitZoom = state.map.getBoundsZoom(state.bounds, true);
    const minZoom = fitZoom - 2.5; // allow wider zoom-out
    const maxZoom = fitZoom + 4;
    state.map.setMinZoom(minZoom);
    state.map.setMaxZoom(maxZoom);
    const current = state.map.getZoom();
    if (current < minZoom) state.map.setZoom(minZoom);
    if (current > maxZoom) state.map.setZoom(maxZoom);
  };

  const initLayers = () => {
    const makeGroup = () => ({
      bench: L.layerGroup(),
      ladder: L.layerGroup(),
      elevator: L.layerGroup(),
      circle: L.layerGroup(),
      sprite: L.layerGroup(),
    });
    state.layers = {
      preset: makeGroup(),
      user: makeGroup(),
    };
    state.zonesLayer = L.layerGroup();
    state.zonesLayer.addTo(state.map);
  };

  const refreshLayerVisibility = () => {
    const { presets, users, benches, ladders, elevators, circles, zones } =
      state.visibility;
    const toggleGroup = (group, enabled) => {
      Object.values(group).forEach((lg) => {
        if (enabled) {
          lg.addTo(state.map);
        } else {
          state.map.removeLayer(lg);
        }
      });
    };

    const typeEnabled = {
      bench: benches,
      ladder: ladders,
      elevator: elevators,
      circle: circles,
      sprite: true,
    };

    // Apply type filters by adding/removing specific subgroups
    ["preset", "user"].forEach((source) => {
      const sourceEnabled = source === "preset" ? presets : users;
      Object.entries(state.layers[source]).forEach(([type, group]) => {
        if (sourceEnabled && typeEnabled[type]) {
          group.addTo(state.map);
        } else {
          state.map.removeLayer(group);
        }
      });
    });

    if (zones) {
      state.zonesLayer.addTo(state.map);
    } else {
      state.map.removeLayer(state.zonesLayer);
    }
  };

  /* Marker data loading */
  const loadPersisted = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state.persisted = parsed;
      if (parsed.gridSize) {
        state.gridSize = parsed.gridSize;
        dom.gridSize.value = String(parsed.gridSize);
      }
      if (parsed.snap !== undefined) {
        state.snap = parsed.snap;
        dom.snapToggle.checked = parsed.snap;
      }
      if (parsed.shinyCenter) {
        state.shiny.center = parsed.shinyCenter;
      }
      if (parsed.customMarkers) {
        state.data.customMarkers = parsed.customMarkers.map((m) =>
          normalizeMarker(m, "user")
        );
      }
    } catch (err) {
      console.warn("Failed to load persisted state", err);
    }
  };

  const loadMarkers = async () => {
    let fetched = [];
    try {
      const res = await fetch("markers.json");
      fetched = await res.json();
    } catch (err) {
      console.warn("Failed to fetch markers.json", err);
    }

    let markersFromFile = [];
    let zonesFromFile = [];
    if (Array.isArray(fetched)) {
      markersFromFile = fetched;
    } else if (fetched && typeof fetched === "object") {
      markersFromFile = fetched.markers || [];
      zonesFromFile = fetched.zones || [];
    }

    const filterNonShiny = (arr) =>
      Array.isArray(arr) ? arr.filter((m) => m?.type !== "shiny") : [];

    const normalizedPresets = filterNonShiny(markersFromFile).map((m) =>
      normalizeMarker(m, "preset")
    );
    state.data.originalPresets = normalizedPresets.map((m) => ({ ...m }));

    const savedPresets = filterNonShiny(state.persisted?.presetMarkers || []);
    const savedUsers = filterNonShiny(state.persisted?.userMarkers || []);
    const savedZones = state.persisted?.zones || [];
    const savedCustom =
      state.persisted?.customMarkers?.map((m) => normalizeMarker(m, "user")) ||
      [];

    const savedById = new Map(savedPresets.map((m) => [m.id, m]));
    const mergedPresets = normalizedPresets.map((marker) => {
      const saved = savedById.get(marker.id);
      return saved ? normalizeMarker(saved, "preset") : marker;
    });
    // Include any saved presets that are missing from file
    savedPresets.forEach((m) => {
      if (!mergedPresets.find((p) => p.id === m.id)) {
        mergedPresets.push(normalizeMarker(m, "preset"));
      }
    });

    state.data.presetMarkers = mergedPresets;
    state.data.userMarkers = savedUsers.map((m) => normalizeMarker(m, "user"));
    state.data.customMarkers =
      savedCustom.length > 0
        ? savedCustom
        : state.data.userMarkers.filter(
            (m) =>
              m.source === "user" &&
              (m.type === "circle" || m.type === "sprite")
          );
    state.data.zones = zonesFromFile
      .concat(savedZones)
      .map((z) => normalizeZone(z));

    renderAllMarkers();
    renderZones();
  };

  const normalizeMarker = (marker, source) => {
    const base = { ...marker };
    base.id = base.id || uuid(source === "preset" ? "pre" : "usr");
    base.type = base.type || "bench";
    base.sprite = base.sprite || "";
    base.label =
      base.label ||
      (base.type === "sprite"
        ? formatStickerLabel(base.sprite)
        : `${base.type} marker`);
    base.lat = toUnits(base.lat);
    base.lng = toUnits(base.lng);
    base.source = source;
    base.locked = Boolean(base.locked);
    if (base.type === "circle" && !base.color) base.color = "#4fc3f7";
    if (base.type !== "sprite") delete base.sprite;
    return base;
  };

  const normalizeZone = (zone) => {
    const base = { ...zone };
    base.id = base.id || uuid("zone");
    base.label = base.label || base.name || `Zone ${base.number || ""}`.trim();
    base.number = base.number || 1;
    base.points = Array.isArray(base.points)
      ? base.points.map((p) => ({ lat: toUnits(p.lat), lng: toUnits(p.lng) }))
      : [];
    return base;
  };

  /* Marker rendering */
  const renderAllMarkers = () => {
    if (!state.layers) return;
    state.markersIndex.forEach(({ view }) => view && view.remove());
    state.markersIndex.clear();

    const all = [...state.data.presetMarkers, ...state.data.userMarkers];
    all.forEach((m) => placeMarker(m));
    refreshLayerVisibility();
    updateIconScales();
    updateShinyRings();
    renderZones();
  };

  const placeMarker = (markerData) => {
    if (markerData.type === "shiny") return; // shiny radius handled separately
    const group = state.layers[markerData.source]?.[markerData.type];
    if (!group) return;
    const marker = createLeafletMarker(markerData);
    marker.__id = markerData.id;
    marker.on("click", (e) => {
      // Keep the map from immediately closing the popup
      if (e?.originalEvent) {
        e.originalEvent.stopPropagation();
        e.originalEvent.preventDefault();
      }
      if (state.deleteMode) {
        deleteMarker(markerData.id);
        return;
      }
      selectMarker(markerData.id);
      const neutral =
        !state.addMode &&
        !state.editMode &&
        !state.deleteMode &&
        !state.measureMode &&
        !state.zoneDrawing.active;
      if (neutral) {
        setTimeout(() => marker.openPopup(), 0);
      } else {
        marker.closePopup();
      }
    });
    marker.on("dragend", () => {
      if (markerData.locked) {
        marker.setLatLng([markerData.lat, markerData.lng]);
        return;
      }
      const snapped = applySnap(marker.getLatLng());
      marker.setLatLng(snapped);
      updateMarkerPosition(markerData.id, snapped);
    });
    marker.bindPopup(() => buildPopupContent(markerData));
    group.addLayer(marker);
    const record = { marker, data: markerData, view: marker };
    state.markersIndex.set(markerData.id, record);
    setDraggability(record.marker, state.editMode);
  };

  const createLeafletMarker = (markerData) => {
    const latlng = L.latLng(markerData.lat, markerData.lng);
    if (markerData.type === "circle") {
      const icon = L.divIcon({
        className: "map-icon circle",
        iconSize: [18, 18],
        html: "",
      });
      const marker = L.marker(latlng, {
        icon,
        draggable: state.editMode,
        bubblingMouseEvents: false,
      });
      marker.on("add", () => {
        const el = marker.getElement();
        if (el) el.style.background = markerData.color || state.currentColor;
        updateIconScales();
      });
      return marker;
    }

    if (markerData.type === "sprite") {
      const icon = L.divIcon({
        className: "map-icon sprite-icon",
        iconSize: [32, 32],
        html: "",
      });
      const marker = L.marker(latlng, {
        icon,
        draggable: state.editMode,
        bubblingMouseEvents: false,
      });
      marker.on("add", () => {
        const el = marker.getElement();
        if (el) {
          el.style.backgroundImage = `url(${getStickerPath(
            markerData.sprite
          )})`;
          el.style.backgroundSize = "contain";
          el.style.backgroundRepeat = "no-repeat";
          el.style.backgroundColor = "transparent";
        }
        updateIconScales();
      });
      return marker;
    }

    const icon = L.divIcon({
      className:
        markerData.type === "shiny" ? "map-icon shiny-center" : "map-icon",
      iconSize: [28, 28],
      html: "",
    });
    const marker = L.marker(latlng, {
      icon,
      draggable: state.editMode,
      bubblingMouseEvents: false,
    });
    marker.on("add", () => {
      const el = marker.getElement();
      if (el) {
        if (markerData.type === "shiny") {
          el.style.backgroundImage = "";
        } else {
          el.style.backgroundImage = `url(${
            ICONS[markerData.type] || ICONS.bench
          })`;
        }
      }
      updateIconScales();
    });
    return marker;
  };

  const setDraggability = (marker, enabled) => {
    if (!marker?.dragging) return;
    if (enabled) marker.dragging.enable();
    else marker.dragging.disable();
  };

  /* Marker CRUD */
  const addMarkerAt = (latlng) => {
    if (!state.currentTool) {
      alert("Select Circle or Pokémon before adding.");
      return;
    }
    const spriteName =
      state.currentTool === "sprite"
        ? dom.stickerSelect.value || state.currentSticker || state.stickers[0]
        : "";
    if (state.currentTool === "sprite" && !spriteName) {
      alert("Choose a sticker first.");
      return;
    }
    if (state.currentTool === "sprite" && spriteName) {
      state.currentSticker = spriteName;
    }
    const label =
      dom.markerLabel.value.trim() ||
      (state.currentTool === "sprite"
        ? formatStickerLabel(spriteName)
        : `${state.currentTool} marker`);
    const marker = normalizeMarker(
      {
        type: state.currentTool,
        label,
        lat: latlng.lat,
        lng: latlng.lng,
        color: state.currentTool === "circle" ? state.currentColor : undefined,
        sprite: state.currentTool === "sprite" ? spriteName : undefined,
      },
      "user"
    );
    state.data.userMarkers.push(marker);
    if (marker.type === "circle" || marker.type === "sprite") {
      state.data.customMarkers.push(marker);
    }
    placeMarker(marker);
    ensureVisibilityFor(marker);
    persist();
  };

  const ensureVisibilityFor = (marker) => {
    if (marker.source === "user") {
      state.visibility.users = true;
      dom.toggleUsers.classList.add("active");
      dom.toggleUsers.classList.remove("toggle-off");
    }
    const typeMap = {
      bench: ["layerBenches", "benches"],
      ladder: ["layerLadders", "ladders"],
      elevator: ["layerElevators", "elevators"],
      circle: ["toggleUsers", "users"],
      sprite: ["toggleUsers", "users"],
    };
    const [control, key] = typeMap[marker.type] || [];
    if (control && dom[control]) {
      dom[control].classList.add("active");
      dom[control].classList.remove("toggle-off");
    }
    if (key) state.visibility[key] = true;
    refreshLayerVisibility();
  };

  const updateMarkerPosition = (id, latlng) => {
    const record = state.markersIndex.get(id);
    if (!record) return;
    record.data.lat = latlng.lat;
    record.data.lng = latlng.lng;
    if (record.rings?.length) {
      record.rings.forEach((r) => r.setLatLng(latlng));
    }
    persist();
  };

  const deleteMarker = (id) => {
    const record = state.markersIndex.get(id);
    if (!record) return;
    if (record.data.locked) return;
    if (record.data.source === "preset") {
      const ok = confirm(
        "Delete preset marker? This will remove it from exports."
      );
      if (!ok) return;
    }
    if (record.view) record.view.remove();
    state.markersIndex.delete(id);
    const arr =
      record.data.source === "preset"
        ? state.data.presetMarkers
        : state.data.userMarkers;
    const idx = arr.findIndex((m) => m.id === id);
    if (idx >= 0) arr.splice(idx, 1);
    if (record.data.type === "circle" || record.data.type === "sprite") {
      const cIdx = state.data.customMarkers.findIndex((m) => m.id === id);
      if (cIdx >= 0) state.data.customMarkers.splice(cIdx, 1);
    }
    if (state.selection === id) {
      state.selection = null;
      dom.inspectorLabel.value = "";
      dom.inspectorColor.value = "#4fc3f7";
      dom.inspectorType.value = "bench";
    }
    persist();
  };

  const applyInspectorEdits = () => {
    if (!state.editMode) {
      alert("Enable Edit mode to apply changes.");
      return;
    }
    const record = state.markersIndex.get(state.selection);
    if (!record || record.data.locked) {
      alert("This marker is locked and cannot be edited.");
      return;
    }
    if (!state.selection) return;
    const nextType = dom.inspectorType.value;
    const nextLabel = dom.inspectorLabel.value.trim() || record.data.label;
    const nextColor = dom.inspectorColor.value;
    const nextSprite =
      nextType === "sprite"
        ? dom.inspectorSticker.value || record.data.sprite
        : undefined;
    const latlng = record.marker?.getLatLng?.();
    if (!latlng) return;
    const updated = normalizeMarker(
      {
        ...record.data,
        type: nextType,
        label:
          nextLabel ||
          (nextType === "sprite"
            ? formatStickerLabel(nextSprite)
            : record.data.label),
        color: nextType === "circle" ? nextColor : undefined,
        sprite: nextSprite,
        lat: latlng.lat,
        lng: latlng.lng,
      },
      record.data.source
    );
    deleteMarker(record.data.id);
    const targetArr =
      updated.source === "preset"
        ? state.data.presetMarkers
        : state.data.userMarkers;
    targetArr.push(updated);
    if (updated.type === "circle" || updated.type === "sprite") {
      state.data.customMarkers.push(updated);
    } else {
      const idx = state.data.customMarkers.findIndex(
        (m) => m.id === updated.id
      );
      if (idx >= 0) state.data.customMarkers.splice(idx, 1);
    }
    placeMarker(updated);
    selectMarker(updated.id);
    ensureVisibilityFor(updated);
    persist();
  };

  /* Popup builder */
  const buildPopupContent = (markerData) => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div style="margin-bottom:6px;"><strong>${markerData.label}</strong></div>
      <div class="hint">${markerData.type} • ${markerData.source}</div>
      <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
        <button data-action="edit"${
          markerData.locked ? " disabled" : ""
        }>Edit</button>
        <button data-action="delete" class="danger"${
          markerData.locked ? " disabled" : ""
        }>Delete</button>
      </div>
    `;
    container.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const action = e.currentTarget.dataset.action;
        if (action === "edit") {
          selectMarker(markerData.id);
          dom.inspectorLabel.focus();
        }
        if (action === "delete") deleteMarker(markerData.id);
      });
    });
    return container;
  };

  const selectMarker = (id) => {
    if (state.selection === id) return;
    if (state.selection) {
      const prev = state.markersIndex
        .get(state.selection)
        ?.marker?.getElement();
      if (prev) prev.classList.remove("selected");
    }
    state.selection = id;
    const record = state.markersIndex.get(id);
    if (!record) return;
    const el = record.marker?.getElement();
    if (el) el.classList.add("selected");
    dom.inspectorLabel.value = record.data.label || "";
    dom.inspectorType.value = record.data.type;
    dom.inspectorColor.value = record.data.color || "#4fc3f7";
    if (record.data.type === "sprite" && record.data.sprite) {
      dom.inspectorSticker.value = record.data.sprite;
    }
    updateInspectorStickerVisibility(record.data.type);
  };

  /* Modes */
  const setMeasureMode = (on) => {
    state.measureMode = on;
    dom.measureBtn.classList.toggle("active", on);
    resetMeasureArtifacts();
    if (on) {
      state.addMode = false;
      state.measureBtn.blur();
      dom.addBtn.classList.remove("active");
      setDeleteMode(false);
    }
  };

  const setAddMode = (on) => {
    state.addMode = on;
    dom.addBtn.classList.toggle("active", on);
    if (on) {
      state.measureMode = false;
      dom.measureBtn.classList.remove("active");
      setDeleteMode(false);
      setZoneMode(false);
    }
  };

  const setEditMode = (on) => {
    state.editMode = on;
    dom.editBtn.classList.toggle("active", on);
    state.markersIndex.forEach(({ marker }) => setDraggability(marker, on));
    if (on) {
      setDeleteMode(false);
      setZoneMode(false);
    } else {
      setDeleteMode(false);
    }
    updateDeleteButtonVisibility();
  };

  const setDeleteMode = (on) => {
    if (!state.editMode) on = false;
    state.deleteMode = on;
    dom.deleteBtn.classList.toggle("active", on);
    if (on) {
      state.addMode = false;
      state.measureMode = false;
      setZoneMode(false);
      dom.addBtn.classList.remove("active");
      dom.measureBtn.classList.remove("active");
    }
  };

  const updateDeleteButtonVisibility = () => {
    const show = state.editMode;
    dom.deleteBtn.classList.toggle("hidden", !show);
    if (!show) {
      dom.deleteBtn.classList.remove("active");
      state.deleteMode = false;
    }
  };

  const setCurrentTool = (tool) => {
    const next =
      tool === "sprite" ? "sprite" : tool === "circle" ? "circle" : null;
    // Toggle off if clicking the active tool
    state.currentTool = next === state.currentTool ? null : next;
    if (dom.typeCircle && dom.typeSprite) {
      const isCircle = state.currentTool === "circle";
      const isSprite = state.currentTool === "sprite";
      dom.typeCircle.classList.toggle("active", isCircle);
      dom.typeSprite.classList.toggle("active", isSprite);
      dom.typeCircle.classList.toggle("toggle-off", !isCircle);
      dom.typeSprite.classList.toggle("toggle-off", !isSprite);
    }
    if (
      state.currentTool === "sprite" &&
      !state.currentSticker &&
      state.stickers.length
    ) {
      state.currentSticker = state.stickers[0];
      dom.stickerSelect.value = state.currentSticker;
    }
    updateAddStickerVisibility();
  };

  const toggleLayer = (key, btn) => {
    state.visibility[key] = !state.visibility[key];
    btn.classList.toggle("active", state.visibility[key]);
    btn.classList.toggle("toggle-off", !state.visibility[key]);
    refreshLayerVisibility();
  };

  const updateAddStickerVisibility = () => {
    const isSprite = state.currentTool === "sprite";
    const isCircle = state.currentTool === "circle";
    const colorRow = dom.markerColor?.closest(".field-row");
    const stickerRow = dom.stickerSelect?.closest(".field-row");
    if (colorRow) colorRow.classList.toggle("disabled", !isCircle);
    if (stickerRow) stickerRow.classList.toggle("disabled", !isSprite);
    if (dom.markerColor) dom.markerColor.disabled = !isCircle;
    if (dom.stickerSelect) dom.stickerSelect.disabled = !isSprite;
    if (isSprite && dom.stickerSelect && !dom.stickerSelect.value) {
      dom.stickerSelect.value = state.currentSticker || state.stickers[0] || "";
    }
  };

  const updateInspectorStickerVisibility = (type) => {
    const isSprite = type === "sprite";
    dom.inspectorColor
      ?.closest(".field-row")
      ?.classList.toggle("hidden", isSprite);
    dom.inspectorSticker
      ?.closest(".field-row")
      ?.classList.toggle("hidden", !isSprite);
    if (isSprite && dom.inspectorSticker && !dom.inspectorSticker.value) {
      dom.inspectorSticker.value =
        state.currentSticker || state.stickers[0] || "";
    }
  };

  const toggleShinyRing = (index, btn) => {
    state.shiny.visible[index] = !state.shiny.visible[index];
    syncShinyRingButtons();
    applyShinyVisibility();
  };

  const syncShinyRingButtons = () => {
    const buttons = [
      [dom.toggleRing50, "50u", state.shiny.visible[0] !== false],
      [dom.toggleRing70, "70u", state.shiny.visible[1] !== false],
    ];
    buttons.forEach(([btn, label, on]) => {
      if (!btn) return;
      btn.classList.toggle("active", on);
      btn.classList.toggle("toggle-off", !on);
      btn.textContent = on ? "Hide" : "Show";
    });
  };

  const setZoneMode = (on) => {
    state.zoneDrawing.active = on;
    dom.zoneBtn.classList.toggle("active", on);
    if (on) {
      state.addMode = false;
      state.measureMode = false;
      setDeleteMode(false);
      dom.addBtn.classList.remove("active");
      dom.measureBtn.classList.remove("active");
      resetZoneDrawing();
      dom.zoneNumber.value = getNextZoneNumber();
    } else {
      resetZoneDrawing();
    }
  };

  /* Map interactions */
  const handleMapClick = (e) => {
    if (state.measureMode) {
      const snapped = applySnap(e.latlng);
      if (!state.measure.origin) {
        state.measure.origin = createMeasureMarker(snapped, "origin");
        return;
      }
      if (!state.measure.target) {
        state.measure.target = createMeasureMarker(snapped, "target");
        drawMeasurement(snapped);
        return;
      }
      state.measure.target.setLatLng(snapped);
      drawMeasurement(snapped);
      return;
    }
    if (state.zoneDrawing.active) {
      handleZoneClick(e.latlng);
      return;
    }
    if (state.deleteMode) return; // deletion handled via marker clicks
    if (!state.addMode) return;
    const snapped = applySnap(e.latlng);
    addMarkerAt(snapped);
  };

  const applySnap = (latlng) => {
    if (!state.snap) return latlng;
    const g = state.gridSize || 1;
    const snapVal = (v) => Math.round(v / g) * g;
    return L.latLng(snapVal(latlng.lat), snapVal(latlng.lng));
  };

  /* Shiny radius (always visible) */
  const createOrUpdateShiny = (center) => {
    if (!state.map) return;
    if (!state.shiny.layer) state.shiny.layer = L.layerGroup().addTo(state.map);
    const layer = state.shiny.layer;
    if (state.shiny.marker) layer.removeLayer(state.shiny.marker);
    state.shiny.rings.forEach((r) => layer.removeLayer(r));
    state.shiny.rings = [];

    const icon = L.divIcon({
      className: "map-icon shiny-center",
      iconSize: [18, 18],
      html: "",
    });
    const marker = L.marker(center, {
      draggable: true,
      icon,
      zIndexOffset: 800,
    }).addTo(layer);
    marker.on("dragend", () => {
      const snapped = applySnap(marker.getLatLng());
      marker.setLatLng(snapped);
      state.shiny.center = snapped;
      updateShinyRings();
      persist();
    });

    const rings = SHINY_DIAMETERS_UNITS.map((diameterUnits, idx) =>
      L.circle(center, {
        radius: (diameterUnits / 2) * state.pixelsPerUnit,
        color: idx === 0 ? "#ffff0aff" : "#ef4444",
        weight: 3,
        dashArray: null,
        fill: false,
        interactive: false,
      }).addTo(layer)
    );

    state.shiny.marker = marker;
    state.shiny.rings = rings;
    state.shiny.center = center;
    updateIconScales();
    applyShinyVisibility();
  };

  const updateShinyRings = () => {
    if (!state.shiny.marker) return;
    const center = state.shiny.center || state.shiny.marker.getLatLng();
    state.shiny.center = center;
    state.shiny.marker.setLatLng(center);
    state.shiny.rings.forEach((ring, idx) => {
      ring.setLatLng(center);
      const diameterUnits =
        SHINY_DIAMETERS_UNITS[idx] || SHINY_DIAMETERS_UNITS[0];
      ring.setRadius((diameterUnits / 2) * state.pixelsPerUnit);
    });
    applyShinyVisibility();
  };

  const applyShinyVisibility = () => {
    if (!state.shiny.layer) return;
    state.shiny.rings.forEach((ring, idx) => {
      if (!ring) return;
      const show = state.shiny.visible[idx] !== false;
      if (show) {
        if (!state.shiny.layer.hasLayer(ring)) ring.addTo(state.shiny.layer);
      } else if (state.shiny.layer.hasLayer(ring)) {
        state.shiny.layer.removeLayer(ring);
      }
    });
  };

  const recenterShiny = () => {
    if (!state.map) return;
    const center = state.map.getCenter();
    createOrUpdateShiny(center);
    persist();
  };

  /* Measurement */
  const initMeasureTools = () => {
    state.measure.group = L.layerGroup().addTo(state.map);
    resetMeasureArtifacts();
  };

  const resetMeasureArtifacts = () => {
    if (state.measure.group) state.measure.group.clearLayers();
    state.measure.origin = null;
    state.measure.target = null;
    state.measure.line = null;
    state.measure.popup = null;
    state.measure.lastTarget = null;
    state.measure.lastPixels = null;
    updateMeasureUI();
  };

  const createMeasureMarker = (latlng, type) => {
    const icon = L.divIcon({
      className: type === "origin" ? "origin-marker" : "target-marker",
      iconSize: [18, 18],
    });
    const marker = L.marker(latlng, {
      draggable: true,
      icon,
      zIndexOffset: type === "origin" ? 600 : 590,
    }).addTo(state.measure.group);
    marker.on("dragend", () => {
      const snapped = applySnap(marker.getLatLng());
      marker.setLatLng(snapped);
      if (type === "origin") state.measure.origin = marker;
      if (type === "target") state.measure.target = marker;
      if (state.measure.origin && state.measure.target)
        drawMeasurement(state.measure.target.getLatLng());
    });
    return marker;
  };

  const drawMeasurement = (target) => {
    if (!state.measure.origin || !state.measure.target) return;
    if (target) state.measure.target.setLatLng(target);
    const origin = state.measure.origin.getLatLng();
    const actualTarget = state.measure.target.getLatLng();
    const points = [origin, actualTarget];
    if (!state.measure.line) {
      state.measure.line = L.polyline(points, {
        className: "measure-line",
        color: "#5ad1f0",
      }).addTo(state.measure.group);
    } else {
      state.measure.line.setLatLngs(points);
    }
    state.measure.lastTarget = actualTarget;
    const { units, pixels } = formatDistance(origin, actualTarget);
    state.measure.lastPixels = Number.parseFloat(pixels);
    const mid = L.latLng(
      (origin.lat + actualTarget.lat) / 2,
      (origin.lng + actualTarget.lng) / 2
    );
    const content = `Distance: ${units} units`;
    if (!state.measure.popup) {
      state.measure.popup = L.popup({ closeButton: false })
        .setLatLng(mid)
        .setContent(content);
      state.measure.popup.openOn(state.map);
    } else {
      state.measure.popup.setLatLng(mid).setContent(content);
      state.measure.popup.openOn(state.map);
    }
    updateMeasureUI();
  };

  const updateMeasureUI = () => {
    dom.measurePixels.textContent = state.measure.lastPixels
      ? Number(state.measure.lastPixels).toFixed(1)
      : "-";
    const units = state.measure.lastPixels
      ? (state.measure.lastPixels / state.pixelsPerUnit).toFixed(2)
      : "-";
    dom.measureUnits.textContent = units;
  };

  /* Zones (Wild Zones) */
  const handleZoneClick = (latlng) => {
    const snapped = applySnap(latlng);
    const pts = state.zoneDrawing.points;
    const markers = state.zoneDrawing.markers || [];
    const closeThreshold = Math.max(state.gridSize || 1, 1);

    if (!pts.length) {
      addZonePoint(snapped, true);
      drawTempZone();
      return;
    }

    const first = pts[0];
    const dist = snapped.distanceTo(first);
    if (pts.length >= 3 && dist <= closeThreshold) {
      finalizeZone();
      return;
    }

    addZonePoint(snapped, false);
    drawTempZone();
  };

  const addZonePoint = (latlng, isFirst) => {
    state.zoneDrawing.points.push(latlng);
    const icon = L.divIcon({
      className: isFirst ? "zone-point first" : "zone-point",
      iconSize: [14, 14],
      html: "",
    });
    const marker = L.marker(latlng, {
      icon,
      interactive: false,
      zIndexOffset: 400,
    }).addTo(state.zonesLayer);
    state.zoneDrawing.markers = state.zoneDrawing.markers || [];
    state.zoneDrawing.markers.push(marker);
  };

  const drawTempZone = () => {
    const pts = state.zoneDrawing.points;
    if (!pts.length) return;
    if (state.zoneDrawing.tempLine)
      state.zonesLayer.removeLayer(state.zoneDrawing.tempLine);
    state.zoneDrawing.tempLine = L.polyline(pts, {
      color: "#22c55e",
      weight: 2,
      dashArray: "6 6",
    }).addTo(state.zonesLayer);

    if (state.zoneDrawing.tempPolygon)
      state.zonesLayer.removeLayer(state.zoneDrawing.tempPolygon);
    if (pts.length >= 3) {
      state.zoneDrawing.tempPolygon = L.polygon(pts, {
        color: "#22c55e",
        weight: 1,
        fillColor: "rgba(74, 222, 128, 0.15)",
        fillOpacity: 0.3,
        interactive: false,
      }).addTo(state.zonesLayer);
    } else {
      state.zoneDrawing.tempPolygon = null;
    }
  };

  const finalizeZone = () => {
    const pts = state.zoneDrawing.points;
    if (pts.length < 3) {
      resetZoneDrawing();
      return;
    }
    const number = parseInt(dom.zoneNumber.value, 10) || getNextZoneNumber();
    const label = dom.zoneLabel.value.trim() || `Zone ${number}`;
    const zone = normalizeZone({
      id: uuid("zone"),
      label,
      number,
      points: pts.map((p) => ({ lat: p.lat, lng: p.lng })),
    });
    state.data.zones.push(zone);
    renderZones();
    persist();
    resetZoneDrawing();
    dom.zoneNumber.value = getNextZoneNumber();
  };

  const resetZoneDrawing = () => {
    if (state.zoneDrawing.tempLine)
      state.zonesLayer.removeLayer(state.zoneDrawing.tempLine);
    if (state.zoneDrawing.tempPolygon)
      state.zonesLayer.removeLayer(state.zoneDrawing.tempPolygon);
    (state.zoneDrawing.markers || []).forEach((m) =>
      state.zonesLayer.removeLayer(m)
    );
    state.zoneDrawing.tempLine = null;
    state.zoneDrawing.tempPolygon = null;
    state.zoneDrawing.points = [];
    state.zoneDrawing.markers = [];
  };

  const renderZones = () => {
    if (!state.zonesLayer) return;
    state.zonesLayer.clearLayers();
    if (!state.visibility.zones) return;
    (state.data.zones || []).forEach((zone) => {
      if (!zone.points?.length) return;
      const polygon = L.polygon(zone.points, {
        color: "#22c55e",
        weight: 2,
        fillColor: "rgba(74, 222, 128, 0.2)",
        fillOpacity: 0.35,
        interactive: false,
      }).addTo(state.zonesLayer);
      const centroid = polygon.getBounds().getCenter();
      const icon = L.divIcon({
        className: "zone-badge",
        html: `${zone.number || ""}`,
        iconSize: [26, 26],
      });
      L.marker(centroid, { icon, interactive: false }).addTo(state.zonesLayer);
    });
  };

  const editZone = (id) => {
    const zone = (state.data.zones || []).find((z) => z.id === id);
    if (!zone) return;
    const newLabel = prompt("Zone label", zone.label);
    if (newLabel === null) return;
    const numInput = prompt("Zone number", zone.number || 1);
    if (numInput === null) return;
    const num = parseInt(numInput, 10);
    if (!num || num < 1 || num > 99) {
      alert("Enter a number between 1 and 99.");
      return;
    }
    zone.label = newLabel.trim() || zone.label;
    zone.number = num;
    renderZones();
    persist();
  };

  const getNextZoneNumber = () => {
    const nums = (state.data.zones || []).map((z) => z.number || 0);
    const max = nums.length ? Math.max(...nums) : 0;
    return Math.min(max + 1, 99);
  };

  /* Shortcuts */
  const handleShortcuts = (e) => {
    const activeTag = document.activeElement?.tagName;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTag)) return;

    switch (e.key.toLowerCase()) {
      case "m":
        setMeasureMode(!state.measureMode);
        break;
      case "p":
        setAddMode(!state.addMode);
        break;
      case "e":
        setEditMode(!state.editMode);
        break;
      case "1":
      case "2":
      case "3":
      case "4":
        setCurrentTool("circle");
        break;
      case "escape":
        closeResetModal();
        if (state.map) state.map.closePopup();
        setAddMode(false);
        break;
      case "delete":
      case "backspace":
        if (state.editMode && state.selection) deleteMarker(state.selection);
        break;
      default:
        return;
    }
  };

  /* Export + storage */
  const collectMarkers = (scope) => {
    let markers = [];
    if (scope === "all" || scope === "preset")
      markers = markers.concat(state.data.presetMarkers);
    if (scope === "all" || scope === "user") {
      const usersOnly = state.data.userMarkers.filter(
        (m) =>
          m.source === "user" &&
          !m.locked &&
          (m.type === "circle" || m.type === "sprite")
      );
      markers = markers.concat(usersOnly);
    }
    const sorted = markers.slice().sort((a, b) => {
      if (a.type === b.type) return a.label.localeCompare(b.label);
      return a.type.localeCompare(b.type);
    });
    return {
      markers: sorted.map(({ source, ...rest }) => rest),
      zones: exportZones(state.data.zones),
    };
  };

  const exportZones = (zones) =>
    (zones || []).map((z) => ({
      id: z.id,
      label: z.label,
      number: z.number,
      points: z.points,
    }));

  const buildUserExport = () => {
    const markers = (state.data.customMarkers || []).map(
      ({ source, ...rest }) => rest
    );
    return { markers };
  };

  const downloadMarkers = (scope) => {
    const data = scope === "user" ? buildUserExport() : collectMarkers(scope);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = scope === "all" ? "markers.json" : `${scope}-markers.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const copyMarkers = async () => {
    const data = buildUserExport();
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      alert("Copied custom markers JSON to clipboard");
    } catch (err) {
      alert("Clipboard unavailable");
    }
  };

  const handleImportUsers = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        let markers = [];
        let zones = state.data.zones;
        if (Array.isArray(parsed)) {
          markers = parsed;
        } else if (parsed && typeof parsed === "object") {
          markers = parsed.markers || [];
          zones = parsed.zones || zones;
        }
        const normalizedMarkers = markers
          .map((m) =>
            normalizeMarker({ ...m, source: "user", locked: false }, "user")
          )
          .filter((m) => m.type === "circle" || m.type === "sprite");
        state.data.userMarkers = normalizedMarkers;
        state.data.customMarkers = normalizedMarkers.slice();
        if (Array.isArray(zones)) {
          state.data.zones = zones.map((z) => normalizeZone(z));
        }
        renderAllMarkers();
        renderZones();
        persist();
        alert("Imported custom markers.");
      } catch (err) {
        alert("Import failed. Please provide a valid markers JSON.");
        console.warn("Import failed", err);
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  const persist = debounce(() => {
    const payload = {
      userMarkers: state.data.userMarkers,
      presetMarkers: state.data.presetMarkers,
      snap: state.snap,
      gridSize: state.gridSize,
      shinyCenter: state.shiny.center,
      zones: state.data.zones,
      customMarkers: state.data.customMarkers,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  });

  /* Reset */
  const openResetModal = () => dom.resetModal.removeAttribute("hidden");
  const closeResetModal = () => dom.resetModal.setAttribute("hidden", "true");

  const handleReset = () => {
    state.data.userMarkers = [];
    state.data.customMarkers = [];
    closeResetModal();
    renderAllMarkers();
    persist();
  };

  /* Panel */
  const togglePanel = () => {
    dom.panel.classList.toggle("collapsed");
    const isCollapsed = dom.panel.classList.contains("collapsed");
    dom.panelToggle.textContent = isCollapsed ? "Expand" : "Collapse";
  };

  // Expose init to window so index.html can call it once Leaflet is ready
  window.addEventListener("DOMContentLoaded", () => init());

  return { init };
})();
