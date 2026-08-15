/*=========================================================
    Pixel RAW - Panneau Recadrage + Niveau (Studio)
    Même convention que retouchPanel.js/masksPanel.js : conteneur dédié
    (#cropPanelStatus), régénéré à chaque renderCropPanel(), écouteurs
    re-liés à chaque fois.
=========================================================*/

const CROP_RATIO_LABELS = [
    { id: "free", label: "Libre" },
    { id: "4:3", label: "4:3" },
    { id: "5:7", label: "5:7" },
    { id: "7:5", label: "7:5" },
    { id: "2:3", label: "2:3" },
    { id: "3:2", label: "3:2" },
    { id: "1:1", label: "1:1" },
    { id: "16:9", label: "16:9" },
    { id: "9:16", label: "9:16" }
];

function initCropController(imageProcessor) {
    if (!imageProcessor) return;

    if (!window.cropCanvasController) {
        window.cropCanvasController = new CropCanvasController(imageProcessor);
    } else {
        window.cropCanvasController.imageProcessor = imageProcessor;
    }

    imageProcessor.cropController = window.cropCanvasController;

    window.cropCanvasController.onCropChange = () => {
        renderCropPanel();
        _saveCropState();
    };
}

function _saveCropState() {
    if (typeof window.saveCurrentPhotoSettingsToCatalog === "function") {
        window.saveCurrentPhotoSettingsToCatalog();
    }
}

/**
 * Bascule le mode édition du recadrage — un seul outil d'édition locale actif
 * à la fois, même principe que le Tampon de duplication (retouchPanel.js) :
 * annule masques/retouche/gomme monochrome à l'activation.
 */
function _toggleCropEditing() {
    const ip = window.imageProcessor;
    if (!ip) return;

    initCropController(ip);

    if (ip.cropPanelActive) {
        ip.cropPanelActive = false;
    } else {
        if (window.MasksManager) window.MasksManager.setActiveMask(null);
        if (window.maskCanvasController) window.maskCanvasController.cancelMode();
        if (typeof window.renderMasksPanel === "function") window.renderMasksPanel();
        if (window.retouchCanvasController) window.retouchCanvasController.cancelMode();
        if (typeof window.renderRetouchPanel === "function") window.renderRetouchPanel();
        if (window.monochromeMaskController) window.monochromeMaskController.cancelMode();
        if (typeof window.renderMonochromePanel === "function") window.renderMonochromePanel();

        ip.cropPanelActive = true;
        window.cropCanvasController._ensureCropSettings();
    }

    ip.render();
    renderCropPanel();
}

function renderCropPanel() {
    const container = document.getElementById("cropPanelStatus");
    const ip = window.imageProcessor;
    if (!container || !ip) return;

    const controller = window.cropCanvasController;
    const ratioId = (ip.cropSettings && ip.cropSettings.ratioId) || (controller ? controller.ratioId : "free");
    const t = ip.transform || { rotation: 0 };
    const base90 = Math.round(t.rotation / 90) * 90;
    const fineAngle = +(t.rotation - base90).toFixed(1);

    const ratioButtons = CROP_RATIO_LABELS.map(({ id, label }) => `
        <button data-crop-ratio="${id}" class="${ratioId === id ? "active" : ""}">${label}</button>
    `).join("");

    const customRatioButton = `
        <button data-crop-action="custom-ratio" class="${ratioId === "custom" ? "active" : ""}">Personnalisé...</button>
    `;

    container.innerHTML = `
        <h3>Recadrage + Niveau</h3>

        <div class="mask-toolbar">
            <button data-crop-action="toggle" class="${ip.cropPanelActive ? "active" : ""}">
                ${ip.cropPanelActive ? "Terminé" : "Modifier le recadrage"}
            </button>
        </div>

        ${ip.cropPanelActive ? `
        <div class="mask-toolbar" style="flex-wrap:wrap;">
            ${ratioButtons}
            ${customRatioButton}
        </div>

        <div class="pc-row" style="margin: 10px 0 6px;">
            <label>Angle fin : <span class="control-value">${fineAngle}°</span></label>
            <input type="range" class="pc-slider" id="cropRangeRotationDegree" min="-45" max="45" step="0.1" value="${fineAngle}">
        </div>

        <div class="mask-toolbar">
            <button data-crop-action="reset">Réinitialiser</button>
        </div>
        ` : `
        <p style="font-size:11px; color:#949ba4;">
            Cadre de recadrage à 8 poignées, ratios fixes, grille des tiers —
            se contraint automatiquement à l'image tournée (Angle fin).
        </p>
        `}
    `;

    _bindCropPanelEvents(container);
}

function _bindCropPanelEvents(container) {
    container.querySelectorAll("[data-crop-action='toggle']").forEach(btn => {
        btn.addEventListener("click", () => _toggleCropEditing());
    });

    container.querySelectorAll("[data-crop-ratio]").forEach(btn => {
        btn.addEventListener("click", () => {
            if (!window.cropCanvasController) return;
            window.cropCanvasController.setRatio(btn.dataset.cropRatio);
            renderCropPanel();
        });
    });

    container.querySelectorAll("[data-crop-action='custom-ratio']").forEach(btn => {
        btn.addEventListener("click", () => _openCropCustomRatioModal());
    });

    container.querySelectorAll("[data-crop-action='reset']").forEach(btn => {
        btn.addEventListener("click", () => {
            if (!window.cropCanvasController || !window.imageProcessor) return;

            window.cropCanvasController.reset();

            // Réinitialiser l'Angle fin (garde les rotations 90° des boutons),
            // même state partagé que le panneau Orientation & Rotation (app.js).
            const ip = window.imageProcessor;
            const base90 = Math.round(ip.transform.rotation / 90) * 90;
            ip.transform = { rotation: base90, flipH: ip.transform.flipH, flipV: ip.transform.flipV };
            ip.setTransform(ip.transform);

            const orientationRange = document.getElementById("rangeRotationDegree");
            const orientationInput = document.getElementById("inputRotationDegree");
            if (orientationRange) orientationRange.value = 0;
            if (orientationInput) orientationInput.value = 0;

            renderCropPanel();
            _saveCropState();
        });
    });

    const rangeDegree = container.querySelector("#cropRangeRotationDegree");
    if (rangeDegree) {
        rangeDegree.addEventListener("input", (e) => {
            const ip = window.imageProcessor;
            if (!ip) return;

            const val = parseFloat(e.target.value) || 0;
            const t = ip.transform;
            const base90 = Math.round(t.rotation / 90) * 90;
            t.rotation = base90 + val;

            // 🔹 Synchronise aussi le curseur du panneau Orientation & Rotation
            // (même state partagé, deux champs DOM distincts — voir app.js).
            const orientationRange = document.getElementById("rangeRotationDegree");
            const orientationInput = document.getElementById("inputRotationDegree");
            if (orientationRange) orientationRange.value = val;
            if (orientationInput) orientationInput.value = val;

            ip.setTransform(t);
            if (window.cropCanvasController) window.cropCanvasController.onFineAngleChange();

            const label = container.querySelector(".control-value");
            if (label) label.textContent = val.toFixed(1) + "°";

            _saveCropState();
        });
    }
}

/**
 * Dialogue "Ratio d'aspect personnalisé" — même style que la modale d'export
 * (index.html #cropCustomRatioModal). Éléments DOM statiques présents dès le
 * chargement de la page : bindings faits une seule fois ici via `onclick`
 * (idempotent, pas de listeners dupliqués si jamais rappelé).
 */
function _initCropCustomRatioModal() {
    const modal = document.getElementById("cropCustomRatioModal");
    const inputW = document.getElementById("cropCustomRatioW");
    const inputH = document.getElementById("cropCustomRatioH");
    const errorEl = document.getElementById("cropCustomRatioError");
    const btnClose = document.getElementById("btnCloseCropCustomRatioModal");
    const btnCancel = document.getElementById("btnCancelCropCustomRatio");
    const btnConfirm = document.getElementById("btnConfirmCropCustomRatio");
    if (!modal || !inputW || !inputH || !btnConfirm) return;

    const close = () => { modal.style.display = "none"; };

    if (btnClose) btnClose.onclick = close;
    if (btnCancel) btnCancel.onclick = close;

    btnConfirm.onclick = () => {
        const w = parseFloat(inputW.value);
        const h = parseFloat(inputH.value);

        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
            if (errorEl) {
                errorEl.textContent = "Saisissez deux nombres positifs (ex. 1 x 1.3).";
                errorEl.style.display = "block";
            }
            return;
        }

        if (!window.cropCanvasController) return;
        window.cropCanvasController.setCustomRatio(w, h);
        close();
        renderCropPanel();
    };
}

function _openCropCustomRatioModal() {
    const modal = document.getElementById("cropCustomRatioModal");
    const inputW = document.getElementById("cropCustomRatioW");
    const inputH = document.getElementById("cropCustomRatioH");
    const errorEl = document.getElementById("cropCustomRatioError");
    if (!modal || !inputW || !inputH) return;

    const controller = window.cropCanvasController;
    inputW.value = controller?.customRatioW ?? 1;
    inputH.value = controller?.customRatioH ?? 1.3;
    if (errorEl) errorEl.style.display = "none";

    modal.style.display = "flex";
}

_initCropCustomRatioModal();

window.initCropController = initCropController;
window.renderCropPanel = renderCropPanel;
