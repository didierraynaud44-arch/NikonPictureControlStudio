let originalPictureControl = null;

/*=========================================================
    Curseur HTML
=========================================================*/

function createSlider(label, id, value, min, max) {
    return `
    <div class="pc-row">
        <div class="pc-label">
            <span>${label}</span>
            <span class="pc-value" id="${id}-value">
                ${value}
            </span>
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
    Événements des sliders et boutons
=========================================================*/

function activateSliders() {
    let renderTimer = null;

    document.querySelectorAll(".pc-slider").forEach(slider => {
        slider.addEventListener("input", () => {
            const value = Number(slider.value);

            // 1. Mise à jour visuelle du chiffre instantanée
            const labelEl = document.getElementById(slider.id + "-value");
            if (labelEl) {
                labelEl.textContent = value;
            }

            // 2. Rendu cadencé (30ms) pour une fluidité optimale
            if (renderTimer) clearTimeout(renderTimer);

            renderTimer = setTimeout(async () => {
                try {
                    const pc = await window.electronAPI.updatePC(slider.id, value);
                    
                    if (window.imageProcessor) {
                        window.imageProcessor.setPictureControl(pc || getLocalSlidersState());
                    }
                } catch (err) {
                    console.error("Erreur mise à jour slider :", err);
                }
            }, 30);
        });
    });

    // Écoute du bouton Réinitialiser
    const resetBtn = document.getElementById("resetPC");
    if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
            try {
                const resetPC = await window.electronAPI.pcReset();
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

function getLocalSlidersState() {
    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? Number(el.value) : 0;
    };

    return {
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
    Construction et injection du panneau
=========================================================*/

function updatePictureControl(info) {
    const panel = document.getElementById("pictureControlStatus");

    if (!panel) return;

    if (!info || !info.pictureControl) {
        panel.innerHTML = "<p>Aucun Picture Control chargé.</p>";
        return;
    }

    if (!originalPictureControl) {
        originalPictureControl = structuredClone(info.pictureControl);
    }

    const pc = info.pictureControl;

    // Déclarations de toutes les variables
    const sharpeningVal = pc.sharpening ?? pc.sharpness ?? pc.sharpning ?? 0;
    const midRangeVal = pc.midRangeSharpening ?? pc.midRangeSharpning ?? 0;
    const clarityVal = pc.clarity ?? 0;
    const contrastVal = pc.contrast ?? 0;
    const highlightsVal = pc.highlights ?? 0;
    const shadowsVal = pc.shadows ?? 0;
    const saturationVal = pc.saturation ?? 0;
    
    // Variables des filtres avancés
    const toneCurveVal = pc.toneCurve ?? pc.curve ?? 0;
    const hueVal = pc.hue ?? pc.colorBalance ?? 0;
    const colorGradingVal = pc.colorGrading ?? pc.grading ?? 0;

    panel.innerHTML = `
        <h2>Picture Control Nikon</h2>

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

        <button id="resetPC" class="btn-reset">
            Réinitialiser
        </button>
    `;

    // Activation des événements
    activateSliders();
}

window.updatePictureControl = updatePictureControl;