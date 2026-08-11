/*=========================================================
    Nikon Picture Control Studio - Panneau de réglages
    Rendu générique réutilisable pour plusieurs conteneurs
    (Studio = complet, Gestionnaire = compact)
=========================================================*/

const originalPictureControlByContainer = {};
const toneCurveWidgetsByContainer = {};

/* ---------------------------------------------------------
   Champs exclusifs au format NP3 (Flexible Color, EXPEED 7)
   Source : types officiels de nikon-flexible-color-picture-control
--------------------------------------------------------- */
const COLOR_BLENDER_KEYS = [
    { key: "red", label: "Rouge" },
    { key: "orange", label: "Orange" },
    { key: "yellow", label: "Jaune" },
    { key: "green", label: "Vert" },
    { key: "cyan", label: "Cyan" },
    { key: "blue", label: "Bleu" },
    { key: "purple", label: "Violet" },
    { key: "magenta", label: "Magenta" }
];

const COLOR_GRADING_ZONES = [
    { key: "highlights", label: "Hautes lumières" },
    { key: "midTone", label: "Tons moyens" },
    { key: "shadows", label: "Ombres" }
];

function miniSlider(label, field, value, min, max, step) {
    return `
    <div class="pc-mini-slider" data-row="${field}">
        <div class="pc-mini-label">
            <span>${label}</span>
            <span class="pc-value" data-value-for="${field}">${value ?? 0}</span>
        </div>
        <input class="pc-slider" data-field="${field}" type="range" min="${min}" max="${max}" value="${value ?? 0}" step="${step}">
    </div>`;
}

function buildNP3SectionHtml(pc) {
    const cb = pc.colorBlender || {};
    const cg = pc.colorGrading || {};

    const blenderRows = COLOR_BLENDER_KEYS.map(({ key, label }) => {
        const v = cb[key] || {};
        return `
        <div class="np3-color-row">
            <div class="np3-color-name">${label}</div>
            ${miniSlider("Teinte", `colorBlender.${key}.hue`, v.hue ?? 0, -100, 100, 1)}
            ${miniSlider("Chroma", `colorBlender.${key}.chroma`, v.chroma ?? 0, -100, 100, 1)}
            ${miniSlider("Luminosité", `colorBlender.${key}.brightness`, v.brightness ?? 0, -100, 100, 1)}
        </div>`;
    }).join("");

    const gradingRows = COLOR_GRADING_ZONES.map(({ key, label }) => {
        const v = cg[key] || {};
        return `
        <div class="np3-color-row">
            <div class="np3-color-name">${label}</div>
            ${miniSlider("Teinte", `colorGrading.${key}.hue`, v.hue ?? 0, 0, 360, 1)}
            ${miniSlider("Chroma", `colorGrading.${key}.chroma`, v.chroma ?? 0, -100, 100, 1)}
            ${miniSlider("Luminosité", `colorGrading.${key}.brightness`, v.brightness ?? 0, -100, 100, 1)}
        </div>`;
    }).join("");

    return `
        <div id="np3ExtendedSection" style="margin-top: 20px;">
            <hr style="border: 0; border-top: 2px solid #5865f2; margin: 15px 0;">
            <h3 style="color:#5865f2;">🎨 Réglages NP3 (Flexible Color)</h3>
            <p style="font-size:11px; color:#949ba4; margin-bottom:10px;">
                Ignorés lors d'un export .NCP — pris en compte uniquement pour l'export .NP3 (Z50 II / EXPEED 7).
            </p>

            <h4 style="margin: 10px 0 6px; color:#dbdee1;">Color Blender</h4>
            <div class="np3-color-grid">
                ${blenderRows}
            </div>

            <h4 style="margin: 16px 0 6px; color:#dbdee1;">Color Grading</h4>
            <div class="np3-color-grid">
                ${gradingRows}
            </div>

            ${miniSlider("Mélange (Blending)", "colorGrading.blending", cg.blending ?? 0, 0, 100, 1)}
            ${miniSlider("Balance", "colorGrading.balance", cg.balance ?? 0, -100, 100, 1)}
        </div>
    `;
}

function createSlider(label, field, value, min, max, step = 1) {
    return `
    <div class="pc-row" data-row="${field}">
        <div class="pc-label">
            <span>${label}</span>
            <span class="pc-value" data-value-for="${field}">${value}</span>
        </div>
        <input
            class="pc-slider"
            data-field="${field}"
            type="range"
            min="${min}"
            max="${max}"
            value="${value}"
            step="${step}"
        >
    </div>
    `;
}

function resolveProfileName(pc) {
    let currentName = pc.name || pc.pictureControlName || pc.basePictureControl || pc.baseProfile || "Standard";
    const upper = currentName.toString().toUpperCase();
    if (upper.includes("VIVID")) return "Vivid";
    if (upper.includes("NEUT")) return "Neutral";
    if (upper.includes("PORTRAIT")) return "Portrait";
    if (upper.includes("LANDSCAPE") || upper.includes("PAYSAGE")) return "Landscape";
    if (upper.includes("FLAT")) return "Flat";
    if (upper.includes("MONO") || upper.includes("MC")) return "Monochrome";
    return "Standard";
}

function buildSortFilterHtml() {
    const state = (window.gridManager && window.gridManager.filterState) ||
        { sortBy: "name", sortDir: "asc", minRating: 0, flagFilter: "all" };

    const sortOptions = [
        { value: "name", label: "Nom" },
        { value: "date", label: "Date" },
        { value: "rating", label: "Note" }
    ].map(o => `<option value="${o.value}" ${state.sortBy === o.value ? "selected" : ""}>${o.label}</option>`).join("");

    const minRatingOptions = [0, 1, 2, 3, 4, 5]
        .map(n => `<option value="${n}" ${state.minRating === n ? "selected" : ""}>${n === 0 ? "Toutes" : "≥ " + n + " ★"}</option>`)
        .join("");

    const flagOptions = [
        { value: "all", label: "Toutes" },
        { value: "validated", label: "Validées uniquement" },
        { value: "rejected", label: "Rejetées uniquement" },
        { value: "none", label: "Non notées uniquement" }
    ].map(o => `<option value="${o.value}" ${state.flagFilter === o.value ? "selected" : ""}>${o.label}</option>`).join("");

    return `
    <div class="card-panel" id="sortFilterPanel" style="margin-bottom: 14px; padding: 10px; background: #171717; border: 1px solid #333; border-radius: 4px;">
        <div style="font-size: 11px; font-weight: bold; color: #aaa; margin-bottom: 8px;">Tri &amp; Filtre</div>

        <div style="display: flex; gap: 6px; margin-bottom: 8px;">
            <select id="sortBySelect" style="flex:1; background:#222; color:#fff; border:1px solid #555; padding:4px 6px; border-radius:4px; font-size: 11px;">
                ${sortOptions}
            </select>
            <button type="button" id="btnSortDir" data-dir="${state.sortDir}" class="btn-tool" style="padding: 3px 8px; font-size: 11px;" title="Inverser l'ordre du tri">${state.sortDir === "desc" ? "⬇️" : "⬆️"}</button>
        </div>

        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
            <span style="font-size: 11px; color: #ccc; white-space: nowrap;">Note min. :</span>
            <select id="minRatingSelect" style="flex:1; background:#222; color:#fff; border:1px solid #555; padding:4px 6px; border-radius:4px; font-size: 11px;">
                ${minRatingOptions}
            </select>
        </div>

        <select id="flagFilterSelect" style="width:100%; background:#222; color:#fff; border:1px solid #555; padding:4px 6px; border-radius:4px; font-size: 11px;">
            ${flagOptions}
        </select>
    </div>
    `;
}

function buildPanelHtml(pc, compact, extendedNP3) {
    const currentName = resolveProfileName(pc);
    const isMono = pc.isMonochrome === true || currentName === "Monochrome";

    return `
        ${compact ? "" : `
        <div class="scope-banner scope-global" style="margin-bottom: 12px;">
            🌍 Réglages GLOBAUX — s'appliquent à <b>toute l'image</b>
        </div>
        `}

        <div class="pc-row" style="margin-bottom: 12px;">
            <label style="font-weight: bold;">Profil :</label>
            <select data-field="pcProfileSelect" class="pc-select" style="background:#222; color:#fff; border:1px solid #555; padding:4px 8px; border-radius:4px;">
                <option value="Standard" ${currentName === 'Standard' ? 'selected' : ''}>Standard</option>
                <option value="Neutral" ${currentName === 'Neutral' ? 'selected' : ''}>Neutre</option>
                <option value="Vivid" ${currentName === 'Vivid' ? 'selected' : ''}>Saturé (Vivid)</option>
                <option value="Monochrome" ${isMono ? 'selected' : ''}>Monochrome</option>
                <option value="Portrait" ${currentName === 'Portrait' ? 'selected' : ''}>Portrait</option>
                <option value="Landscape" ${currentName === 'Landscape' ? 'selected' : ''}>Paysage</option>
                <option value="Flat" ${currentName === 'Flat' ? 'selected' : ''}>Uniforme (Flat)</option>
            </select>
        </div>

        <!-- 🔹 NOUVEAU : Histogramme, juste sous le sélecteur de profil (uniquement en mode non-compact, Studio) -->
        ${compact ? "" : `
        <div class="card-panel" id="histogramPanel" style="margin-bottom: 14px; padding: 10px; background: #171717; border: 1px solid #333; border-radius: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 11px; font-weight: bold; color: #aaa;">Histogramme</span>
                <button id="btnToggleHistoMode" class="btn-tool" style="padding: 2px 8px; font-size: 10px;" title="Basculer Luminance / RVB">RVB</button>
            </div>
            <canvas id="histogramCanvas" width="360" height="100" style="width: 100%; height: 100px; display: block; background: #111; border-radius: 3px;"></canvas>
        </div>
        `}

        <!-- 🔹 NOUVEAU : Tri & Filtre de la Galerie, sous l'Histogramme (mode non-compact
             uniquement). Reste visible en vue Photo pour préparer un filtre avant de
             basculer sur Galerie — les contrôles reflètent l'état courant de GridManager. -->
        ${compact ? "" : buildSortFilterHtml()}

        ${compact ? "" : `
        <div style="margin-bottom: 15px; background: #1e1f22; padding: 10px; border-radius: 6px; border: 1px solid #35373c;">
            <h4 style="color: #5865f2; font-size: 11px; text-transform: uppercase; margin-bottom: 8px;">
                🌡️ Balance des Blancs
            </h4>
            ${createSlider("Température", "wbTemperature", pc.wbTemperature ?? 0, -100, 100, 1)}
            ${createSlider("Teinte (Tint)", "wbTint", pc.wbTint ?? 0, -100, 100, 1)}
        </div>
        `}

        <div data-block="monochrome" style="display: ${isMono ? 'block' : 'none'}; background: #2a2a2a; padding: 10px; border-radius: 6px; margin-bottom: 12px; border: 1px solid #444;">
            <h4 style="margin-top:0; color: #e0e0e0;">📷 Options Monochrome</h4>

            <div class="pc-row" style="margin-bottom: 8px;">
                <label>Filtre optique :</label>
                <select data-field="filterEffect" class="pc-select" style="background:#111; color:#fff; border:1px solid #555; padding:3px;">
                    <option value="OFF" ${pc.filterEffect === 'OFF' ? 'selected' : ''}>Neutre (OFF)</option>
                    <option value="YELLOW" ${pc.filterEffect === 'YELLOW' ? 'selected' : ''}>Jaune (Y)</option>
                    <option value="ORANGE" ${pc.filterEffect === 'ORANGE' ? 'selected' : ''}>Orange (O)</option>
                    <option value="RED" ${pc.filterEffect === 'RED' ? 'selected' : ''}>Rouge (R)</option>
                    <option value="GREEN" ${pc.filterEffect === 'GREEN' ? 'selected' : ''}>Vert (G)</option>
                </select>
            </div>

            <div class="pc-row" style="margin-bottom: 8px;">
                <label>Virage :</label>
                <select data-field="toningEffect" class="pc-select" style="background:#111; color:#fff; border:1px solid #555; padding:3px;">
                    <option value="B&W" ${pc.toningEffect === 'B&W' ? 'selected' : ''}>N&B Pur</option>
                    <option value="SEPIA" ${pc.toningEffect === 'SEPIA' ? 'selected' : ''}>Sépia</option>
                    <option value="CYANOTYPE" ${pc.toningEffect === 'CYANOTYPE' ? 'selected' : ''}>Cyanotype</option>
                    <option value="VIOLET" ${pc.toningEffect === 'VIOLET' ? 'selected' : ''}>Violet</option>
                    <option value="RED" ${pc.toningEffect === 'RED' ? 'selected' : ''}>Rouge</option>
                    <option value="GREEN" ${pc.toningEffect === 'GREEN' ? 'selected' : ''}>Vert</option>
                    <option value="BLUE" ${pc.toningEffect === 'BLUE' ? 'selected' : ''}>Bleu</option>
                </select>
            </div>

            <div class="pc-row">
                <label>Intensité virage : <span data-value-for="toningAmount">${pc.toningAmount || 1}</span></label>
                <input type="range" class="pc-slider" data-field="toningAmount" min="1" max="7" step="1" value="${pc.toningAmount || 1}">
            </div>
        </div>

        ${createSlider("Accentuation", "sharpening", pc.sharpening ?? 0, -3, 9, 0.1)}
        ${createSlider("Accentuation moyenne", "midRangeSharpening", pc.midRangeSharpening ?? 0, -5, 5, 0.1)}
        ${createSlider("Clarté", "clarity", pc.clarity ?? 0, -5, 5, 0.1)}
        ${createSlider("Contraste", "contrast", pc.contrast ?? 0, -3, 3, 0.1)}
        ${createSlider("Luminosité", "brightness", pc.brightness ?? 0, -1.5, 1.5, 0.05)}
        ${createSlider("Saturation", "saturation", pc.saturation ?? 0, -3, 3, 0.1)}
        ${createSlider("Teinte", "hue", pc.hue ?? 0, -3, 3, 0.1)}

        ${compact ? "" : `
        <hr style="border: 0; border-top: 1px solid #444; margin: 15px 0;">
        <h3 style="margin-bottom: 10px;">Exposition</h3>
        ${createSlider("Exposition (EV)", "exposure", pc.exposure ?? 0, -3, 3, 0.05)}

        <hr style="border: 0; border-top: 1px solid #444; margin: 15px 0;">
        <h3 style="margin-bottom: 10px;">Point noir &amp; Point blanc</h3>
        ${createSlider("Point noir", "blackPoint", pc.blackPoint ?? 0, 0, 250, 1)}
        ${createSlider("Point blanc", "whitePoint", pc.whitePoint ?? 255, 5, 255, 1)}

        <hr style="border: 0; border-top: 1px solid #444; margin: 15px 0;">
        <h3 style="margin-bottom: 10px;">Traitement de l'image</h3>
        ${createSlider("Hautes lumières", "highlights", pc.highlights ?? 0, -5, 5, 0.1)}
        ${createSlider("Ombres", "shadows", pc.shadows ?? 0, -5, 5, 0.1)}
        ${createSlider("Correction du voile", "dehaze", pc.dehaze ?? 0, 0, 10, 0.1)}
        ${createSlider("Vibrance", "vibrance", pc.vibrance ?? 0, -5, 5, 0.1)}

        <div style="margin: 12px 0;">
            <label style="font-weight: bold; color: #00aaff; font-size: 13px;">Courbe de tonalité :</label>
            <div data-tonecurve-container></div>
        </div>

        ${createSlider("Vignettage", "vignette", pc.vignette ?? 0, -5, 5, 0.1)}
        ${createSlider("Réduction du bruit", "denoise", pc.denoise ?? 0, 0, 5, 0.1)}

        <div class="pc-row" style="margin-top: 10px;">
            <label>Correction de l'objectif :</label>
            <input type="checkbox" data-field="lensCorrection" class="pc-checkbox" ${pc.lensCorrection ? 'checked' : ''}>
        </div>
        `}

        ${extendedNP3 ? buildNP3SectionHtml(pc) : ""}

        <br><br>
        <button data-action="reset" class="btn-reset">Réinitialiser</button>
    `;
}

/**
 * Rend le panneau de réglages dans un conteneur donné.
 */
function renderPictureControlPanel(containerId, pc, options = {}) {
    const { compact = false, extendedNP3 = false, isNewInstance = false, onChange = null, onReset = null } = options;
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`⚠️ Conteneur #${containerId} introuvable pour le panneau Picture Control`);
        return;
    }

    const defaultPC = {
        name: "Standard",
        pictureControlName: "Standard",
        baseProfile: "STANDARD",
        wbTemperature: 0,
        wbTint: 0,
        sharpening: 3,
        midRangeSharpening: 2,
        clarity: 1,
        contrast: 0,
        brightness: 0,
        saturation: 0,
        hue: 0,
        exposure: 0,
        blackPoint: 0,
        whitePoint: 255,
        highlights: 0,
        shadows: 0,
        dehaze: 0,
        vibrance: 0,
        vignette: 0,
        denoise: 0,
        lensCorrection: false
    };

    const currentPC = pc || defaultPC;

    currentPC.wbTemperature = currentPC.wbTemperature ?? 0;
    currentPC.wbTint = currentPC.wbTint ?? 0;
    currentPC.sharpening = currentPC.sharpening ?? currentPC.sharpning ?? currentPC.sharpness ?? 3;
    currentPC.midRangeSharpening = currentPC.midRangeSharpening ?? currentPC.midRangeSharpning ?? 2;

    if (isNewInstance || !originalPictureControlByContainer[containerId]) {
        originalPictureControlByContainer[containerId] = structuredClone(currentPC);
    }

    container.innerHTML = buildPanelHtml(currentPC, compact, extendedNP3);

    const isMono = currentPC.isMonochrome === true || resolveProfileName(currentPC) === "Monochrome";
    const satRow = container.querySelector('[data-row="saturation"]');
    const hueRow = container.querySelector('[data-row="hue"]');
    if (satRow) satRow.style.display = isMono ? "none" : "flex";
    if (hueRow) hueRow.style.display = isMono ? "none" : "flex";

    let toneCurveWidget = null;
    if (!compact && window.ToneCurveWidget) {
        const curveContainer = container.querySelector('[data-tonecurve-container]');
        if (curveContainer) {
            curveContainer.id = `${containerId}-toneCurveContainer`;
            toneCurveWidget = new ToneCurveWidget(curveContainer.id, () => trigger());
            toneCurveWidgetsByContainer[containerId] = toneCurveWidget;
        }
    } else {
        delete toneCurveWidgetsByContainer[containerId];
    }

    function readState() {
        const getVal = (field) => {
            const el = container.querySelector(`[data-field="${field}"]`);
            return el ? Number(el.value) : 0;
        };
        const getBool = (field) => {
            const el = container.querySelector(`[data-field="${field}"]`);
            return el ? el.checked : false;
        };
        const getStr = (field, fallback) => {
            const el = container.querySelector(`[data-field="${field}"]`);
            return el ? el.value : fallback;
        };

        const profileSelect = container.querySelector('[data-field="pcProfileSelect"]');
        const profileName = profileSelect ? profileSelect.value : "Standard";
        const isMonoNow = profileName === "Monochrome";
        const curveLut = toneCurveWidget ? toneCurveWidget.getLUT() : null;
        const sharpVal = getVal("sharpening");
        const midVal = getVal("midRangeSharpening");

        const baseState = {
            name: profileName,
            pictureControlName: profileName,
            baseProfile: profileName.toUpperCase(),
            basePictureControl: profileName.toUpperCase(),
            isMonochrome: isMonoNow,

            wbTemperature: compact ? (currentPC.wbTemperature ?? 0) : getVal("wbTemperature"),
            wbTint: compact ? (currentPC.wbTint ?? 0) : getVal("wbTint"),

            sharpening: sharpVal,
            sharpning: sharpVal,
            midRangeSharpening: midVal,
            midRangeSharpning: midVal,

            clarity: getVal("clarity"),
            contrast: getVal("contrast"),
            brightness: getVal("brightness"),
            saturation: isMonoNow ? -100 : getVal("saturation"),
            hue: getVal("hue"),

            filterEffect: getStr("filterEffect", "OFF"),
            toningEffect: getStr("toningEffect", "B&W"),
            toningAmount: getVal("toningAmount"),

            exposure: compact ? (currentPC.exposure ?? 0) : getVal("exposure"),
            blackPoint: compact ? (currentPC.blackPoint ?? 0) : getVal("blackPoint"),
            whitePoint: compact ? (currentPC.whitePoint ?? 255) : getVal("whitePoint"),
            highlights: compact ? (currentPC.highlights ?? 0) : getVal("highlights"),
            shadows: compact ? (currentPC.shadows ?? 0) : getVal("shadows"),
            dehaze: compact ? (currentPC.dehaze ?? 0) : getVal("dehaze"),
            vibrance: compact ? (currentPC.vibrance ?? 0) : getVal("vibrance"),
            vignette: compact ? (currentPC.vignette ?? 0) : getVal("vignette"),
            denoise: compact ? (currentPC.denoise ?? 0) : getVal("denoise"),
            lensCorrection: compact ? !!currentPC.lensCorrection : getBool("lensCorrection"),

            toneCurveLut: curveLut
        };

        if (extendedNP3) {
            const colorBlender = {};
            COLOR_BLENDER_KEYS.forEach(({ key }) => {
                colorBlender[key] = {
                    hue: getVal(`colorBlender.${key}.hue`),
                    chroma: getVal(`colorBlender.${key}.chroma`),
                    brightness: getVal(`colorBlender.${key}.brightness`)
                };
            });

            const colorGrading = {};
            COLOR_GRADING_ZONES.forEach(({ key }) => {
                colorGrading[key] = {
                    hue: getVal(`colorGrading.${key}.hue`),
                    chroma: getVal(`colorGrading.${key}.chroma`),
                    brightness: getVal(`colorGrading.${key}.brightness`)
                };
            });
            colorGrading.blending = getVal("colorGrading.blending");
            colorGrading.balance = getVal("colorGrading.balance");

            baseState.colorBlender = colorBlender;
            baseState.colorGrading = colorGrading;
        }

        return baseState;
    }

    function trigger() {
        const state = readState();
        if (typeof onChange === "function") onChange(state);
    }

    let renderTimer = null;
    container.querySelectorAll(".pc-slider").forEach(slider => {
        slider.addEventListener("input", () => {
            const value = Number(slider.value);
            const label = container.querySelector(`[data-value-for="${slider.dataset.field}"]`);
            if (label) label.textContent = value;
            if (renderTimer) clearTimeout(renderTimer);
            renderTimer = setTimeout(trigger, 30);
        });
    });

    container.querySelectorAll(".pc-select, .pc-checkbox").forEach(el => {
        el.addEventListener("change", trigger);
    });

    // 🔹 NOUVEAU : Bascule Histogramme Luminance / RVB
    // (rebranché à chaque appel car le DOM du panneau est régénéré via innerHTML)
    const btnToggleHistoMode = container.querySelector("#btnToggleHistoMode");
    if (btnToggleHistoMode && window.imageProcessor) {
        btnToggleHistoMode.textContent = window.imageProcessor.histogramMode === "rgb" ? "Luminance" : "RVB";
        btnToggleHistoMode.addEventListener("click", () => {
            const mode = window.imageProcessor.toggleHistogramMode();
            btnToggleHistoMode.textContent = mode === "rgb" ? "Luminance" : "RVB";
        });
    }

    // 🔹 NOUVEAU : Tri & Filtre de la Galerie (rebranché à chaque appel, DOM régénéré)
    const sortBySelect = container.querySelector("#sortBySelect");
    const btnSortDir = container.querySelector("#btnSortDir");
    const minRatingSelect = container.querySelector("#minRatingSelect");
    const flagFilterSelect = container.querySelector("#flagFilterSelect");

    function applyGridFilterSort() {
        if (!window.gridManager || typeof window.gridManager.applyFilterSort !== "function") return;
        window.gridManager.applyFilterSort({
            sortBy: sortBySelect ? sortBySelect.value : "name",
            sortDir: btnSortDir ? btnSortDir.dataset.dir : "asc",
            minRating: minRatingSelect ? parseInt(minRatingSelect.value, 10) : 0,
            flagFilter: flagFilterSelect ? flagFilterSelect.value : "all"
        });
    }

    if (btnSortDir) {
        btnSortDir.addEventListener("click", () => {
            const newDir = btnSortDir.dataset.dir === "desc" ? "asc" : "desc";
            btnSortDir.dataset.dir = newDir;
            btnSortDir.textContent = newDir === "desc" ? "⬇️" : "⬆️";
            applyGridFilterSort();
        });
    }
    if (sortBySelect) sortBySelect.addEventListener("change", applyGridFilterSort);
    if (minRatingSelect) minRatingSelect.addEventListener("change", applyGridFilterSort);
    if (flagFilterSelect) flagFilterSelect.addEventListener("change", applyGridFilterSort);

    const profileSelect = container.querySelector('[data-field="pcProfileSelect"]');
    if (profileSelect) {
        profileSelect.addEventListener("change", () => {
            const selectedProfile = profileSelect.value;
            const isMonoSel = selectedProfile === "Monochrome";

            const presetValues = {
                Standard:   { sharpening: 3, midRangeSharpening: 2, clarity: 1, contrast: 0, saturation: 0, hue: 0 },
                Neutral:    { sharpening: 2, midRangeSharpening: 1, clarity: 0, contrast: -1, saturation: -1, hue: 0 },
                Vivid:      { sharpening: 4, midRangeSharpening: 3, clarity: 1.5, contrast: 2, saturation: 2, hue: 0 },
                Portrait:   { sharpening: 2, midRangeSharpening: 1, clarity: -0.5, contrast: -1, saturation: 0, hue: 0 },
                Landscape:  { sharpening: 5, midRangeSharpening: 3, clarity: 2, contrast: 2, saturation: 2, hue: 0 },
                Flat:       { sharpening: 2, midRangeSharpening: 1, clarity: 0, contrast: -3, saturation: -2, hue: 0 },
                Monochrome: { sharpening: 3, midRangeSharpening: 2, clarity: 1, contrast: 1, saturation: -100, hue: 0 }
            };
            const vals = presetValues[selectedProfile] || presetValues.Standard;

            const setSlider = (field, val) => {
                const el = container.querySelector(`[data-field="${field}"]`);
                const label = container.querySelector(`[data-value-for="${field}"]`);
                if (el) el.value = val;
                if (label) label.textContent = val;
            };

            setSlider("sharpening", vals.sharpening);
            setSlider("midRangeSharpening", vals.midRangeSharpening);
            setSlider("clarity", vals.clarity);
            setSlider("contrast", vals.contrast);
            setSlider("saturation", isMonoSel ? -100 : vals.saturation);
            setSlider("hue", vals.hue);

            if (!compact) {
                setSlider("wbTemperature", 0);
                setSlider("wbTint", 0);
                setSlider("exposure", 0);
                setSlider("blackPoint", 0);
                setSlider("whitePoint", 255);
                setSlider("highlights", 0);
                setSlider("shadows", 0);
                setSlider("dehaze", 0);
                setSlider("vibrance", 0);
            }

            const monoBlock = container.querySelector('[data-block="monochrome"]');
            const satRow2 = container.querySelector('[data-row="saturation"]');
            const hueRow2 = container.querySelector('[data-row="hue"]');
            if (monoBlock) monoBlock.style.display = isMonoSel ? "block" : "none";
            if (satRow2) satRow2.style.display = isMonoSel ? "none" : "flex";
            if (hueRow2) hueRow2.style.display = isMonoSel ? "none" : "flex";

            if (toneCurveWidget) toneCurveWidget.reset();

            trigger();
        });
    }

    const resetBtn = container.querySelector('[data-action="reset"]');
    if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
            try {
                let resetPC = null;
                if (typeof onReset === "function") {
                    resetPC = await onReset();
                }
                const finalPC = resetPC || structuredClone(originalPictureControlByContainer[containerId]);
                renderPictureControlPanel(containerId, finalPC, options);
                if (typeof onChange === "function") onChange(finalPC);
            } catch (err) {
                console.error("Erreur reset PC :", err);
            }
        });
    }
}

window.renderPictureControlPanel = renderPictureControlPanel;
window.createSlider = createSlider;

window.updatePictureControl = function (info, isNewPhoto = false) {
    const pc = info && info.pictureControl ? info.pictureControl : null;
    renderPictureControlPanel("pictureControlStatus", pc, {
        compact: false,
        isNewInstance: isNewPhoto,
        onChange: (state) => {
            if (window.imageProcessor) window.imageProcessor.setPictureControl(state);
        },
        onReset: async () => {
            return await window.electronAPI?.pcReset();
        }
    });
};