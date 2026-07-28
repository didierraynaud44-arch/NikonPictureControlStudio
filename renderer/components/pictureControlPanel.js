/*=========================================================
    Nikon Picture Control Studio - Panneau Latéral (Mise à jour)
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

    // 1. Changement de Profil Nikon
    const profileSelect = document.getElementById("pcProfileSelect");
    if (profileSelect) {
        profileSelect.addEventListener("change", () => {
            const selectedProfile = profileSelect.value;
            const isMono = selectedProfile === "Monochrome" || selectedProfile === "MC";

            const monoBlock = document.getElementById("monochromeBlock");
            const satRow = document.getElementById("row-saturation");
            const hueRow = document.getElementById("row-hue");

            if (monoBlock) monoBlock.style.display = isMono ? "block" : "none";
            if (satRow) satRow.style.display = isMono ? "none" : "flex";
            if (hueRow) hueRow.style.display = isMono ? "none" : "flex";

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
                
                // Réinitialiser également le canvas de la courbe
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

    // Extraction de la Look-Up Table de la Courbe de Tonalité si présente
    const curveLut = window.toneCurveWidget ? window.toneCurveWidget.getLUT() : null;

    return {
        name: profileName,
        pictureControlName: profileName,
        isMonochrome: isMono,

        // --- Picture Control Nikon Officiel ---
        sharpening: getVal("sharpening"),
        midRangeSharpening: getVal("midRangeSharpening"),
        clarity: getVal("clarity"),
        contrast: getVal("contrast"),
        brightness: getVal("brightness"),
        saturation: getVal("saturation"),
        hue: getVal("hue"),

        // Options N&B
        filterEffect: filterEl ? filterEl.value : "OFF",
        toningEffect: toningEl ? toningEl.value : "B&W",
        toningAmount: getVal("toningAmount"),

        // --- Traitement de l'image (Avancé) ---
        highlights: getVal("highlights"),
        shadows: getVal("shadows"),
        dehaze: getVal("dehaze"),
        vibrance: getVal("vibrance"),
        vignette: getVal("vignette"),
        denoise: getVal("denoise"),
        lensCorrection: getBool("lensCorrection"),

        // Courbe de Tonalité (Interactive)
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
    const currentName = pc.name || pc.pictureControlName || "Standard";
    const isMono = pc.isMonochrome === true || currentName === "Monochrome" || currentName === "MC";

    panel.innerHTML = `
        <h2>Picture Control Nikon</h2>

        <!-- Profil -->
        <div class="pc-row" style="margin-bottom: 12px;">
            <label for="pcProfileSelect" style="font-weight: bold;">Profil :</label>
            <select id="pcProfileSelect" class="pc-select" style="background:#222; color:#fff; border:1px solid #555; padding:4px 8px; border-radius:4px;">
                <option value="Standard" ${!isMono && currentName === 'Standard' ? 'selected' : ''}>Standard</option>
                <option value="Neutral" ${currentName === 'Neutral' ? 'selected' : ''}>Neutre</option>
                <option value="Vivid" ${currentName === 'Vivid' ? 'selected' : ''}>Saturé (Vivid)</option>
                <option value="Monochrome" ${isMono ? 'selected' : ''}>Monochrome</option>
                <option value="Portrait" ${currentName === 'Portrait' ? 'selected' : ''}>Portrait</option>
                <option value="Landscape" ${currentName === 'Landscape' ? 'selected' : ''}>Paysage</option>
                <option value="Flat" ${currentName === 'Flat' ? 'selected' : ''}>Uniforme (Flat)</option>
            </select>
        </div>

        <!-- Options Monochrome -->
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

        <!-- Sliders officiels Nikon -->
        ${createSlider("Accentuation", "sharpening", pc.sharpening ?? 0, -3, 9, 0.25)}
        ${createSlider("Accentuation moyenne", "midRangeSharpening", pc.midRangeSharpening ?? 0, -5, 5, 0.25)}
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
        
        <!-- Module Graphique Courbe de Tonalité -->
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

    // Instanciation du Widget de la Courbe
    if (window.ToneCurveWidget && document.getElementById("toneCurveContainer")) {
        window.toneCurveWidget = new ToneCurveWidget("toneCurveContainer", () => {
            triggerEngineUpdate();
        });
    }

    activateEventListeners();
    triggerEngineUpdate();
}

window.updatePictureControl = updatePictureControl;