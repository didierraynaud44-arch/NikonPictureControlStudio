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

function buildPanelHtml(pc, compact, extendedNP3) {
    const currentName = resolveProfileName(pc);
    const isMono = pc.isMonochrome === true || currentName === "Monochrome";

    return `
        <h2>Picture Control Nikon</h2>

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

        ${createSlider("Accentuation", "sharpening", pc.sharpening ?? 0, -3, 9, 0.25)}
        ${createSlider("Accentuation moyenne", "midRangeSharpening", pc.midRangeSharpening ?? 0, -5, 5, 0.25)}
        ${createSlider("Clarté", "clarity", pc.clarity ?? 0, -5, 5, 0.25)}
        ${createSlider("Contraste", "contrast", pc.contrast ?? 0, -3, 3, 0.25)}
        ${createSlider("Luminosité", "brightness", pc.brightness ?? 0, -1.5, 1.5, 0.1)}
        ${createSlider("Saturation", "saturation", pc.saturation ?? 0, -3, 3, 0.25)}
        ${createSlider("Teinte", "hue", pc.hue ?? 0, -3, 3, 0.25)}

        ${compact ? "" : `
        <hr style="border: 0; border-top: 1px solid #444; margin: 15px 0;">
        <h3>Exposition</h3>
        ${createSlider("Exposition (EV)", "exposure", pc.exposure ?? 0, -3, 3, 0.1)}

        <hr style="border: 0; border-top: 1px solid #444; margin: 15px 0;">
        <h3>Point noir &amp; Point blanc</h3>
        ${createSlider("Point noir", "blackPoint", pc.blackPoint ?? 0, 0, 250, 1)}
        ${createSlider("Point blanc", "whitePoint", pc.whitePoint ?? 255, 5, 255, 1)}

        <hr style="border: 0; border-top: 1px solid #444; margin: 15px 0;">
        <h3>Traitement de l'image</h3>
        ${createSlider("Hautes lumières", "highlights", pc.highlights ?? 0, -5, 5, 0.25)}
        ${createSlider("Ombres", "shadows", pc.shadows ?? 0, -5, 5, 0.25)}
        ${createSlider("Correction du voile", "dehaze", pc.dehaze ?? 0, 0, 10, 0.5)}
        ${createSlider("Vibrance", "vibrance", pc.vibrance ?? 0, -5, 5, 0.25)}

        <div style="margin: 12px 0;">
            <label style="font-weight: bold; color: #00aaff; font-size: 13px;">Courbe de tonalité :</label>
            <div data-tonecurve-container></div>
        </div>

        ${createSlider("Vignettage", "vignette", pc.vignette ?? 0, -5, 5, 0.25)}
        ${createSlider("Réduction du bruit", "denoise", pc.denoise ?? 0, 0, 5, 0.5)}

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
 * @param {string} containerId  id du <div> cible (ex: "pictureControlStatus", "profileControlStatus")
 * @param {object|null} pc      Picture Control à afficher (null => message vide)
 * @param {object} options
 *   - compact {boolean}       masque la section "Traitement de l'image" (Hautes lumières/Ombres/
 *                              Correction du voile/Vibrance/Courbe/Vignettage/Bruit/Objectif)
 *   - isNewInstance {boolean} force la mémorisation d'un nouvel état "original" pour le Reset
 *   - onChange {function}     appelé avec le state courant à chaque modification
 *   - onReset {async function} optionnel, doit renvoyer un Picture Control ou rien
 */
function renderPictureControlPanel(containerId, pc, options = {}) {
    const { compact = false, extendedNP3 = false, isNewInstance = false, onChange = null, onReset = null } = options;
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`⚠️ Conteneur #${containerId} introuvable pour le panneau Picture Control`);
        return;
    }

    if (!pc) {
        container.innerHTML = "<p>Aucun Picture Control chargé.</p>";
        delete originalPictureControlByContainer[containerId];
        return;
    }

    // Normalisation des clés de netteté
    pc.sharpening = pc.sharpening ?? pc.sharpning ?? pc.sharpness ?? 0;
    pc.midRangeSharpening = pc.midRangeSharpening ?? pc.midRangeSharpning ?? 0;

    if (isNewInstance || !originalPictureControlByContainer[containerId]) {
        originalPictureControlByContainer[containerId] = structuredClone(pc);
    }

    container.innerHTML = buildPanelHtml(pc, compact, extendedNP3);

    const isMono = pc.isMonochrome === true || resolveProfileName(pc) === "Monochrome";
    const satRow = container.querySelector('[data-row="saturation"]');
    const hueRow = container.querySelector('[data-row="hue"]');
    if (satRow) satRow.style.display = isMono ? "none" : "flex";
    if (hueRow) hueRow.style.display = isMono ? "none" : "flex";

    // Courbe de tonalité : uniquement en mode complet
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

            // Champs absents du panneau compact : on conserve les valeurs déjà connues
            exposure: compact ? (pc.exposure ?? 0) : getVal("exposure"),
            blackPoint: compact ? (pc.blackPoint ?? 0) : getVal("blackPoint"),
            whitePoint: compact ? (pc.whitePoint ?? 255) : getVal("whitePoint"),
            highlights: compact ? (pc.highlights ?? 0) : getVal("highlights"),
            shadows: compact ? (pc.shadows ?? 0) : getVal("shadows"),
            dehaze: compact ? (pc.dehaze ?? 0) : getVal("dehaze"),
            vibrance: compact ? (pc.vibrance ?? 0) : getVal("vibrance"),
            vignette: compact ? (pc.vignette ?? 0) : getVal("vignette"),
            denoise: compact ? (pc.denoise ?? 0) : getVal("denoise"),
            lensCorrection: compact ? !!pc.lensCorrection : getBool("lensCorrection"),

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

    // Sliders
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

    // Selects / checkbox
    container.querySelectorAll(".pc-select, .pc-checkbox").forEach(el => {
        el.addEventListener("change", trigger);
    });

    // Sélecteur de profil -> applique les presets
    const profileSelect = container.querySelector('[data-field="pcProfileSelect"]');
    if (profileSelect) {
        profileSelect.addEventListener("change", () => {
            const selectedProfile = profileSelect.value;
            const isMonoSel = selectedProfile === "Monochrome";

            const presetValues = {
                Standard:  { sharpening: 3, midRangeSharpening: 2, clarity: 1, contrast: 0, saturation: 0, hue: 0 },
                Neutral:   { sharpening: 2, midRangeSharpening: 1, clarity: 0, contrast: -1, saturation: -1, hue: 0 },
                Vivid:     { sharpening: 4, midRangeSharpening: 3, clarity: 1.5, contrast: 2, saturation: 2, hue: 0 },
                Portrait:  { sharpening: 2, midRangeSharpening: 1, clarity: -0.5, contrast: -1, saturation: 0, hue: 0 },
                Landscape: { sharpening: 5, midRangeSharpening: 3, clarity: 2, contrast: 2, saturation: 2, hue: 0 },
                Flat:      { sharpening: 2, midRangeSharpening: 1, clarity: 0, contrast: -3, saturation: -2, hue: 0 },
                Monochrome:{ sharpening: 3, midRangeSharpening: 2, clarity: 1, contrast: 1, saturation: -100, hue: 0 }
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

    // Réinitialiser
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

// --- Compatibilité rétroactive : panneau complet du Studio ---
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
