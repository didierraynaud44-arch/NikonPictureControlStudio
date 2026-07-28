/*=========================================================
    Nikon Picture Control Studio - Panneau Latéral
=========================================================*/

// Sauvegarde du Picture Control initial pour la réinitialisation
let originalPictureControl = null;

/*=========================================================
    Composants HTML
=========================================================*/
function createSlider(label, id, value, min, max) {
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
            step="1"
        >
    </div>
    `;
}

/*=========================================================
    Événements et synchronisation du moteur
=========================================================*/
function activateEventListeners() {
    let renderTimer = null;

    // 1. Écoute du changement de profil dans le menu déroulant
    const profileSelect = document.getElementById("pcProfileSelect");
    if (profileSelect) {
        profileSelect.addEventListener("change", () => {
            const selectedProfile = profileSelect.value;
            const isMono = selectedProfile === "Monochrome" || selectedProfile === "MC";

            // Bascule de la visibilité des blocs
            const monoBlock = document.getElementById("monochromeBlock");
            const satRow = document.getElementById("row-saturation");
            const hueRow = document.getElementById("row-hue");

            if (monoBlock) monoBlock.style.display = isMono ? "block" : "none";
            if (satRow) satRow.style.display = isMono ? "none" : "flex";
            if (hueRow) hueRow.style.display = isMono ? "none" : "flex";

            triggerEngineUpdate();
        });
    }

    // 2. Écoute des Sliders (avec debounce de 30ms pour la fluidité)
    document.querySelectorAll(".pc-slider").forEach(slider => {
        slider.addEventListener("input", () => {
            const value = Number(slider.value);
            const labelEl = document.getElementById(slider.id + "-value");
            if (labelEl) labelEl.textContent = value;

            if (renderTimer) clearTimeout(renderTimer);
            renderTimer = setTimeout(() => triggerEngineUpdate(), 30);
        });
    });

    // 3. Écoute des contrôles Monochrome (Filtre optique, Virage, Intensité)
    const filterSelect = document.getElementById("filterEffect");
    const toningSelect = document.getElementById("toningEffect");
    const toningSlider = document.getElementById("toningAmount");

    [filterSelect, toningSelect, toningSlider].forEach(el => {
        if (el) {
            el.addEventListener("change", () => triggerEngineUpdate());
            el.addEventListener("input", () => {
                if (el.id === "toningAmount") {
                    const valEl = document.getElementById("toningAmountVal");
                    if (valEl) valEl.textContent = el.value;
                }
                triggerEngineUpdate();
            });
        }
    });

    // 4. Écoute du bouton Réinitialiser
    const resetBtn = document.getElementById("resetPC");
    if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
            try {
                const resetPC = await window.electronAPI?.pcReset();
                const finalPC = resetPC || structuredClone(originalPictureControl);

                updatePictureControl({ pictureControl: finalPC });

                if (window.imageProcessor) {
                    window.imageProcessor.setPictureControl(finalPC);
                }
            } catch (err) {
                console.error("Erreur reset PC :", err);
            }
        });
    }
}

/**
 * Récupère l'état courant de l'IHM et l'envoie au moteur Canvas
 */
function triggerEngineUpdate() {
    const state = getLocalControlsState();
    
    // Notification IPC si Electron est configuré
    if (window.electronAPI?.updatePC) {
        window.electronAPI.updatePC(state);
    }

    // Mise à jour directe du pipeline Canvas
    if (window.imageProcessor) {
        window.imageProcessor.setPictureControl(state);
    }
}

/**
 * Construit un objet Picture Control complet depuis l'état actuel de l'IHM
 */
function getLocalControlsState() {
    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? Number(el.value) : 0;
    };

    const profileSelect = document.getElementById("pcProfileSelect");
    const profileName = profileSelect ? profileSelect.value : "Standard";
    const isMono = profileName === "Monochrome" || profileName === "MC";

    const filterEl = document.getElementById("filterEffect");
    const toningEl = document.getElementById("toningEffect");

    return {
        name: profileName,
        pictureControlName: profileName,
        isMonochrome: isMono,

        // Options spécifiques Monochrome
        filterEffect: filterEl ? filterEl.value : "OFF",
        toningEffect: toningEl ? toningEl.value : "B&W",
        toningAmount: getVal("toningAmount"),

        // Sliders standards
        sharpening: getVal("sharpening"),
        midRangeSharpening: getVal("midRangeSharpening"),
        clarity: getVal("clarity"),
        contrast: getVal("contrast"),
        highlights: getVal("highlights"),
        shadows: getVal("shadows"),
        saturation: getVal("saturation"),
        toneCurve: getVal("toneCurve"),
        hue: getVal("hue"),
        colorGrading: getVal("colorGrading")
    };
}

/*=========================================================
    Construction et Injection du Panneau Lateral
=========================================================*/
function updatePictureControl(info, isNewPhoto = false) {
    const panel = document.getElementById("pictureControlStatus");
    if (!panel) return;

    if (!info || !info.pictureControl) {
        panel.innerHTML = "<p>Aucun Picture Control chargé.</p>";
        originalPictureControl = null;
        return;
    }

    // Conserve le Picture Control initial
    if (isNewPhoto || !originalPictureControl) {
        originalPictureControl = structuredClone(info.pictureControl);
    }

    const pc = info.pictureControl;
    
    // Détection globale du mode Monochrome
    const currentName = pc.name || pc.pictureControlName || "Standard";
    const isMono = pc.isMonochrome === true || 
                   currentName === "Monochrome" || 
                   currentName === "MC" || 
                   pc.description === "Monochrome";

    // Chargement des valeurs des sliders
    const sharpeningVal = pc.sharpening ?? pc.sharpness ?? 0;
    const midRangeVal = pc.midRangeSharpening ?? 0;
    const clarityVal = pc.clarity ?? 0;
    const contrastVal = pc.contrast ?? 0;
    const highlightsVal = pc.highlights ?? 0;
    const shadowsVal = pc.shadows ?? 0;
    const saturationVal = pc.saturation ?? 0;
    const toneCurveVal = pc.toneCurve ?? 0;
    const hueVal = pc.hue ?? 0;
    const colorGradingVal = pc.colorGrading ?? 0;

    // Chargement des options N&B
    const filterVal = pc.filterEffect || "OFF";
    const toningVal = pc.toningEffect || "B&W";
    const toningAmountVal = pc.toningAmount || 1;

    panel.innerHTML = `
        <h2>Picture Control Nikon</h2>

        <!-- 1. Sélecteur de Profil -->
        <div class="pc-row" style="margin-bottom: 15px;">
            <label for="pcProfileSelect" style="font-weight: bold;">Profil :</label>
            <select id="pcProfileSelect" style="background:#222; color:#fff; border:1px solid #555; padding:4px 8px; border-radius:4px;">
                <option value="Standard" ${!isMono && currentName === 'Standard' ? 'selected' : ''}>Standard</option>
                <option value="Neutral" ${currentName === 'Neutral' ? 'selected' : ''}>Neutre</option>
                <option value="Vivid" ${currentName === 'Vivid' ? 'selected' : ''}>Saturé (Vivid)</option>
                <option value="Monochrome" ${isMono ? 'selected' : ''}>Monochrome</option>
                <option value="Portrait" ${currentName === 'Portrait' ? 'selected' : ''}>Portrait</option>
                <option value="Landscape" ${currentName === 'Landscape' ? 'selected' : ''}>Paysage</option>
                <option value="Flat" ${currentName === 'Flat' ? 'selected' : ''}>Uniforme (Flat)</option>
            </select>
        </div>

        <!-- 2. Bloc Options Monochrome -->
        <div id="monochromeBlock" style="display: ${isMono ? 'block' : 'none'}; background: #2a2a2a; padding: 10px; border-radius: 6px; margin-bottom: 15px; border: 1px solid #444;">
            <h4 style="margin-top:0; color: #e0e0e0;">📷 Options Monochrome</h4>
            
            <div class="pc-row" style="margin-bottom: 8px;">
                <label for="filterEffect">Filtre optique :</label>
                <select id="filterEffect" style="background:#111; color:#fff; border:1px solid #555; padding:3px;">
                    <option value="OFF" ${filterVal === 'OFF' ? 'selected' : ''}>Neutre (OFF)</option>
                    <option value="YELLOW" ${filterVal === 'YELLOW' ? 'selected' : ''}>Jaune (Y)</option>
                    <option value="ORANGE" ${filterVal === 'ORANGE' ? 'selected' : ''}>Orange (O)</option>
                    <option value="RED" ${filterVal === 'RED' ? 'selected' : ''}>Rouge (R)</option>
                    <option value="GREEN" ${filterVal === 'GREEN' ? 'selected' : ''}>Vert (G)</option>
                </select>
            </div>

            <div class="pc-row" style="margin-bottom: 8px;">
                <label for="toningEffect">Virage :</label>
                <select id="toningEffect" style="background:#111; color:#fff; border:1px solid #555; padding:3px;">
                    <option value="B&W" ${toningVal === 'B&W' ? 'selected' : ''}>N&B Pur</option>
                    <option value="SEPIA" ${toningVal === 'SEPIA' ? 'selected' : ''}>Sépia</option>
                    <option value="CYANOTYPE" ${toningVal === 'CYANOTYPE' ? 'selected' : ''}>Cyanotype</option>
                    <option value="VIOLET" ${toningVal === 'VIOLET' ? 'selected' : ''}>Violet</option>
                    <option value="RED" ${toningVal === 'RED' ? 'selected' : ''}>Rouge</option>
                    <option value="GREEN" ${toningVal === 'GREEN' ? 'selected' : ''}>Vert</option>
                    <option value="BLUE" ${toningVal === 'BLUE' ? 'selected' : ''}>Bleu</option>
                </select>
            </div>

            <div class="pc-row">
                <label for="toningAmount">Intensité virage : <span id="toningAmountVal">${toningAmountVal}</span></label>
                <input type="range" id="toningAmount" min="1" max="7" step="1" value="${toningAmountVal}">
            </div>
        </div>

        <!-- 3. Sliders de réglages standards -->
        ${createSlider("Netteté", "sharpening", sharpeningVal, -3, 9)}
        ${createSlider("Netteté moyenne", "midRangeSharpening", midRangeVal, -5, 5)}
        ${createSlider("Clarté", "clarity", clarityVal, -5, 5)}
        ${createSlider("Contraste", "contrast", contrastVal, -3, 3)}
        ${createSlider("Hautes lumières", "highlights", highlightsVal, -5, 5)}
        ${createSlider("Ombres", "shadows", shadowsVal, -5, 5)}
        ${createSlider("Saturation", "saturation", saturationVal, -3, 3)}

        <hr style="border: 0; border-top: 1px solid #444; margin: 15px 0;">

        <h3>Ajustements Avancés</h3>
        ${createSlider("Courbe de tonalité", "toneCurve", toneCurveVal, -5, 5)}
        ${createSlider("Teinte / Balance Couleur", "hue", hueVal, -5, 5)}
        ${createSlider("Étalonnage (Color Grading)", "colorGrading", colorGradingVal, -5, 5)}

        <br><br>

        <button id="resetPC" class="btn-reset">Réinitialiser</button>
    `;

    // Masque la saturation si le mode est Monochrome
    const satRow = document.getElementById("row-saturation");
    if (satRow) satRow.style.display = isMono ? "none" : "flex";

    // Active les écouteurs d'événements
    activateEventListeners();

    // Force la synchronisation du rendu Canvas
    triggerEngineUpdate();
}

// Exportation globale
window.updatePictureControl = updatePictureControl;