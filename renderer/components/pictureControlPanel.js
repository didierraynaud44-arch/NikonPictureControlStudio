/*=========================================================
    Nikon Picture Control Studio - Panneau Latéral
=========================================================*/

let originalPictureControl = null;

function createSlider(label, id, value, min, max, step = 1) {
    return `
    <div class="pc-row" id="row-${id}">
        <div class="pc-label">
            <span>${label}</span>
            <span class="pc-value" id="${id}-value">${value}</span>
        </div>
        <input
            class="pc-slider"
            id="${id}"
            type="range"
            min="${min}"
            max="${max}"
            value="${value}"
            step="${step}"
        >
    </div>
    `;
}

function activateEventListeners() {
    let renderTimer = null;

    // 1. Changement de Profil Nikon via le menu déroulant
    const profileSelect = document.getElementById("pcProfileSelect");
    if (profileSelect) {
        profileSelect.addEventListener("change", () => {
            const selectedProfile = profileSelect.value;
            const isMono = selectedProfile === "Monochrome" || selectedProfile === "MC";

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

            const updateSlider = (id, val) => {
                const el = document.getElementById(id);
                const txt = document.getElementById(id + "-value");
                if (el) el.value = val;
                if (txt) txt.textContent = val;
            };

            updateSlider("sharpening", vals.sharpening);
            updateSlider("midRangeSharpening", vals.midRangeSharpening);
            updateSlider("clarity", vals.clarity);
            updateSlider("contrast", vals.contrast);
            updateSlider("saturation", isMono ? -100 : vals.saturation);
            updateSlider("hue", vals.hue);

            updateSlider("highlights", 0);
            updateSlider("shadows", 0);
            updateSlider("dehaze", 0);
            updateSlider("vibrance", 0);

            const monoBlock = document.getElementById("monochromeBlock");
            const satRow = document.getElementById("row-saturation");
            const hueRow = document.getElementById("row-hue");

            if (monoBlock) monoBlock.style.display = isMono ? "block" : "none";
            if (satRow) satRow.style.display = isMono ? "none" : "flex";
            if (hueRow) hueRow.style.display = isMono ? "none" : "flex";

            if (window.toneCurveWidget) {
                window.toneCurveWidget.reset();
            }

            triggerEngineUpdate();
        });
    }

    // 2. Sliders
    document.querySelectorAll(".pc-slider").forEach(slider => {
        slider.addEventListener("input", () => {
            const value = Number(slider.value);
            const labelEl = document.getElementById(slider.id + "-value");
            if (labelEl) labelEl.textContent = value;

            if (renderTimer) clearTimeout(renderTimer);
            renderTimer = setTimeout(() => triggerEngineUpdate(), 30);
        });
    });

    // 3. Selects / Checkbox
    document.querySelectorAll(".pc-select, .pc-checkbox").forEach(el => {
        el.addEventListener("change", () => triggerEngineUpdate());
    });

    // 4. Bouton Réinitialiser
    const resetBtn = document.getElementById("resetPC");
    if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
            try {
                const resetPC = await window.electronAPI?.pcReset();
                const finalPC = resetPC || structuredClone(originalPictureControl);
                
                if (window.toneCurveWidget) {
                    window.toneCurveWidget.reset();
                }
                
                updatePictureControl({ pictureControl: finalPC });
            } catch (err) {
                console.error("Erreur reset PC :", err);
            }
        });
    }
}

function triggerEngineUpdate() {
    const state = getLocalControlsState();
    if (window.imageProcessor) {
        window.imageProcessor.setPictureControl(state);
    }
}

function getLocalControlsState() {
    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? Number(el.value) : 0;
    };

    const getBool = (id) => {
        const el = document.getElementById(id);
        return el ? el.checked : false;
    };

    const profileSelect = document.getElementById("pcProfileSelect");
    const profileName = profileSelect ? profileSelect.value : "Standard";
    const isMono = profileName === "Monochrome" || profileName === "MC";

    const filterEl = document.getElementById("filterEffect");
    const toningEl = document.getElementById("toningEffect");

    const curveLut = window.toneCurveWidget ? window.toneCurveWidget.getLUT() : null;

    const currentSharpness = getVal("sharpening");
    const currentMidSharpness = getVal("midRangeSharpening");

    return {
        name: profileName,
        pictureControlName: profileName,
        baseProfile: profileName.toUpperCase(),
        basePictureControl: profileName.toUpperCase(),
        isMonochrome: isMono,

        // 🎯 Envoi sous les deux orthographes (sharpening + sharpning) pour compatibilité binaire
        sharpening: currentSharpness,
        sharpning: currentSharpness,
        midRangeSharpening: currentMidSharpness,
        midRangeSharpning: currentMidSharpness,

        clarity: getVal("clarity"),
        contrast: getVal("contrast"),
        brightness: getVal("brightness"),
        saturation: isMono ? -100 : getVal("saturation"),
        hue: getVal("hue"),

        filterEffect: filterEl ? filterEl.value : "OFF",
        toningEffect: toningEl ? toningEl.value : "B&W",
        toningAmount: getVal("toningAmount"),

        highlights: getVal("highlights"),
        shadows: getVal("shadows"),
        dehaze: getVal("dehaze"),
        vibrance: getVal("vibrance"),
        vignette: getVal("vignette"),
        denoise: getVal("denoise"),
        lensCorrection: getBool("lensCorrection"),

        toneCurveLut: curveLut
    };
}

function updatePictureControl(info, isNewPhoto = false) {
    const panel = document.getElementById("pictureControlStatus");
    if (!panel) return;

    if (!info || !info.pictureControl) {
        panel.innerHTML = "<p>Aucun Picture Control chargé.</p>";
        originalPictureControl = null;
        return;
    }

    if (isNewPhoto || !originalPictureControl) {
        originalPictureControl = structuredClone(info.pictureControl);
    }

    const pc = info.pictureControl;

    // Normalisation des clés de netteté
    pc.sharpening = pc.sharpening ?? pc.sharpning ?? pc.sharpness ?? 0;
    pc.midRangeSharpening = pc.midRangeSharpening ?? pc.midRangeSharpning ?? 0;

    let currentName = pc.name || pc.pictureControlName || pc.basePictureControl || pc.baseProfile || "Standard";
    
    // Correspondance stricte pour le select
    const upper = currentName.toString().toUpperCase();
    if (upper.includes("VIVID")) currentName = "Vivid";
    else if (upper.includes("NEUT")) currentName = "Neutral";
    else if (upper.includes("PORTRAIT")) currentName = "Portrait";
    else if (upper.includes("LANDSCAPE") || upper.includes("PAYSAGE")) currentName = "Landscape";
    else if (upper.includes("FLAT")) currentName = "Flat";
    else if (upper.includes("MONO") || upper.includes("MC")) currentName = "Monochrome";
    else currentName = "Standard";

    const isMono = pc.isMonochrome === true || currentName === "Monochrome";

    panel.innerHTML = `
        <h2>Picture Control Nikon</h2>

        <div class="pc-row" style="margin-bottom: 12px;">
            <label for="pcProfileSelect" style="font-weight: bold;">Profil :</label>
            <select id="pcProfileSelect" class="pc-select" style="background:#222; color:#fff; border:1px solid #555; padding:4px 8px; border-radius:4px;">
                <option value="Standard" ${currentName === 'Standard' ? 'selected' : ''}>Standard</option>
                <option value="Neutral" ${currentName === 'Neutral' ? 'selected' : ''}>Neutre</option>
                <option value="Vivid" ${currentName === 'Vivid' ? 'selected' : ''}>Saturé (Vivid)</option>
                <option value="Monochrome" ${isMono ? 'selected' : ''}>Monochrome</option>
                <option value="Portrait" ${currentName === 'Portrait' ? 'selected' : ''}>Portrait</option>
                <option value="Landscape" ${currentName === 'Landscape' ? 'selected' : ''}>Paysage</option>
                <option value="Flat" ${currentName === 'Flat' ? 'selected' : ''}>Uniforme (Flat)</option>
            </select>
        </div>

        <div id="monochromeBlock" style="display: ${isMono ? 'block' : 'none'}; background: #2a2a2a; padding: 10px; border-radius: 6px; margin-bottom: 12px; border: 1px solid #444;">
            <h4 style="margin-top:0; color: #e0e0e0;">📷 Options Monochrome</h4>
            
            <div class="pc-row" style="margin-bottom: 8px;">
                <label for="filterEffect">Filtre optique :</label>
                <select id="filterEffect" class="pc-select" style="background:#111; color:#fff; border:1px solid #555; padding:3px;">
                    <option value="OFF" ${pc.filterEffect === 'OFF' ? 'selected' : ''}>Neutre (OFF)</option>
                    <option value="YELLOW" ${pc.filterEffect === 'YELLOW' ? 'selected' : ''}>Jaune (Y)</option>
                    <option value="ORANGE" ${pc.filterEffect === 'ORANGE' ? 'selected' : ''}>Orange (O)</option>
                    <option value="RED" ${pc.filterEffect === 'RED' ? 'selected' : ''}>Rouge (R)</option>
                    <option value="GREEN" ${pc.filterEffect === 'GREEN' ? 'selected' : ''}>Vert (G)</option>
                </select>
            </div>

            <div class="pc-row" style="margin-bottom: 8px;">
                <label for="toningEffect">Virage :</label>
                <select id="toningEffect" class="pc-select" style="background:#111; color:#fff; border:1px solid #555; padding:3px;">
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
                <label for="toningAmount">Intensité virage : <span id="toningAmountVal">${pc.toningAmount || 1}</span></label>
                <input type="range" class="pc-slider" id="toningAmount" min="1" max="7" step="1" value="${pc.toningAmount || 1}">
            </div>
        </div>

        ${createSlider("Accentuation", "sharpening", pc.sharpening, -3, 9, 0.25)}
        ${createSlider("Accentuation moyenne", "midRangeSharpening", pc.midRangeSharpening, -5, 5, 0.25)}
        ${createSlider("Clarté", "clarity", pc.clarity ?? 0, -5, 5, 0.25)}
        ${createSlider("Contraste", "contrast", pc.contrast ?? 0, -3, 3, 0.25)}
        ${createSlider("Luminosité", "brightness", pc.brightness ?? 0, -1.5, 1.5, 0.1)}
        ${createSlider("Saturation", "saturation", pc.saturation ?? 0, -3, 3, 0.25)}
        ${createSlider("Teinte", "hue", pc.hue ?? 0, -3, 3, 0.25)}

        <hr style="border: 0; border-top: 1px solid #444; margin: 15px 0;">

        <h3>Traitement de l'image</h3>
        ${createSlider("Hautes lumières", "highlights", pc.highlights ?? 0, -5, 5, 0.25)}
        ${createSlider("Ombres", "shadows", pc.shadows ?? 0, -5, 5, 0.25)}
        ${createSlider("Correction du voile", "dehaze", pc.dehaze ?? 0, 0, 10, 0.5)}
        ${createSlider("Vibrance", "vibrance", pc.vibrance ?? 0, -5, 5, 0.25)}
        
        <div style="margin: 12px 0;">
            <label style="font-weight: bold; color: #00aaff; font-size: 13px;">Courbe de tonalité :</label>
            <div id="toneCurveContainer"></div>
        </div>

        ${createSlider("Vignettage", "vignette", pc.vignette ?? 0, -5, 5, 0.25)}
        ${createSlider("Réduction du bruit", "denoise", pc.denoise ?? 0, 0, 5, 0.5)}

        <div class="pc-row" style="margin-top: 10px;">
            <label for="lensCorrection">Correction de l'objectif :</label>
            <input type="checkbox" id="lensCorrection" class="pc-checkbox" ${pc.lensCorrection ? 'checked' : ''}>
        </div>

        <br><br>
        <button id="resetPC" class="btn-reset">Réinitialiser</button>
    `;

    const satRow = document.getElementById("row-saturation");
    const hueRow = document.getElementById("row-hue");
    if (satRow) satRow.style.display = isMono ? "none" : "flex";
    if (hueRow) hueRow.style.display = isMono ? "none" : "flex";

    if (window.ToneCurveWidget && document.getElementById("toneCurveContainer")) {
        window.toneCurveWidget = new ToneCurveWidget("toneCurveContainer", () => {
            triggerEngineUpdate();
        });
    }

    activateEventListeners();
    // 🎯 Retrait de triggerEngineUpdate() ici pour préserver les réglages importés
}

window.updatePictureControl = updatePictureControl;