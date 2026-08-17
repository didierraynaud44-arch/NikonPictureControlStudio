/*=========================================================
    Pixel RAW - Panneau Correction de perspective (Studio)
    Même convention que cropPanel.js/retouchPanel.js.
=========================================================*/

function initPerspectiveController(imageProcessor) {
    if (!imageProcessor) return;

    if (!window.perspectiveCanvasController) {
        window.perspectiveCanvasController = new PerspectiveCanvasController(imageProcessor);
    } else {
        window.perspectiveCanvasController.imageProcessor = imageProcessor;
    }

    imageProcessor.perspectiveController = window.perspectiveCanvasController;

    window.perspectiveCanvasController.onPerspectiveChange = () => {
        renderPerspectivePanel();
        _savePerspectiveState();
    };
}

function _savePerspectiveState() {
    if (typeof window.saveCurrentPhotoSettingsToCatalog === "function") {
        window.saveCurrentPhotoSettingsToCatalog();
    }
}

/**
 * Bascule le mode édition (4 poignées visibles/interactives) — un seul outil
 * d'édition locale actif à la fois, même principe que crop/masques/retouche.
 */
function _togglePerspectiveEditing() {
    const ip = window.imageProcessor;
    if (!ip) return;

    initPerspectiveController(ip);

    if (ip.perspectivePanelActive) {
        ip.perspectivePanelActive = false;
    } else {
        if (window.MasksManager) window.MasksManager.setActiveMask(null);
        if (window.maskCanvasController) window.maskCanvasController.cancelMode();
        if (typeof window.renderMasksPanel === "function") window.renderMasksPanel();
        if (window.retouchCanvasController) window.retouchCanvasController.cancelMode();
        if (typeof window.renderRetouchPanel === "function") window.renderRetouchPanel();
        if (window.imageProcessor.cropPanelActive) {
            window.imageProcessor.cropPanelActive = false;
            if (typeof window.renderCropPanel === "function") window.renderCropPanel();
        }

        ip.perspectivePanelActive = true;
        window.perspectiveCanvasController._ensurePerspectiveSettings();
    }

    ip.render();
    renderPerspectivePanel();
}

/**
 * Curseurs "Vertical"/"Horizontal" (raccourci Lightroom-like) : repositionne
 * les 4 coins directement, sans second système de transformation — vertical
 * agit sur l'axe X des coins du HAUT (le bas reste fixe à 0/1), horizontal
 * sur l'axe Y des coins de DROITE (la gauche reste fixe à 0/1). Combinables.
 */
function _applyKeystoneSliders() {
    const ip = window.imageProcessor;
    const persp = window.perspectiveCanvasController._ensurePerspectiveSettings();

    const maxShift = 0.35;
    const vShift = ((persp.verticalValue || 0) / 100) * maxShift;
    const hShift = ((persp.horizontalValue || 0) / 100) * maxShift;

    persp.corners = [
        { x: 0 + vShift, y: 0 },            // tl
        { x: 1 - vShift, y: 0 + hShift },   // tr
        { x: 0, y: 1 },                     // bl
        { x: 1, y: 1 - hShift }             // br
    ];

    ip.render();
}

function renderPerspectivePanel() {
    const container = document.getElementById("perspectivePanelStatus");
    const ip = window.imageProcessor;
    if (!container || !ip) return;

    const persp = ip.perspectiveSettings;
    const vertical = persp?.verticalValue || 0;
    const horizontal = persp?.horizontalValue || 0;

    container.innerHTML = `
        <h3>Correction de perspective</h3>

        <div class="mask-toolbar">
            <button data-perspective-action="toggle" class="${ip.perspectivePanelActive ? "active" : ""}">
                ${ip.perspectivePanelActive ? "Terminé" : "Activer la correction manuelle"}
            </button>
        </div>

        ${ip.perspectivePanelActive ? `
        <p style="font-size:11px; color:#949ba4; margin:8px 0;">
            Glisse les 4 poignées sur les bords d'un élément qui devrait être
            rectangulaire (façade, porte...), ou utilise les curseurs ci-dessous
            pour un réglage rapide.
        </p>

        <div class="pc-row" style="margin-bottom:6px;">
            <label>Vertical : <span class="control-value">${vertical}</span></label>
            <input type="range" class="pc-slider" id="perspectiveVertical" min="-100" max="100" step="1" value="${vertical}">
        </div>

        <div class="pc-row" style="margin-bottom:10px;">
            <label>Horizontal : <span class="control-value">${horizontal}</span></label>
            <input type="range" class="pc-slider" id="perspectiveHorizontal" min="-100" max="100" step="1" value="${horizontal}">
        </div>

        <div class="mask-toolbar">
            <button data-perspective-action="reset">Réinitialiser</button>
        </div>
        ` : `
        <p style="font-size:11px; color:#949ba4;">
            Redresse les lignes convergentes (façades, portes...) par
            homographie 4 points.
        </p>
        `}
    `;

    _bindPerspectivePanelEvents(container);
}

function _bindPerspectivePanelEvents(container) {
    container.querySelectorAll("[data-perspective-action='toggle']").forEach(btn => {
        btn.addEventListener("click", () => _togglePerspectiveEditing());
    });

    container.querySelectorAll("[data-perspective-action='reset']").forEach(btn => {
        btn.addEventListener("click", () => {
            if (!window.perspectiveCanvasController) return;
            window.perspectiveCanvasController.reset();
            const persp = window.imageProcessor.perspectiveSettings;
            if (persp) { persp.verticalValue = 0; persp.horizontalValue = 0; }
            renderPerspectivePanel();
            _savePerspectiveState();
        });
    });

    const verticalSlider = container.querySelector("#perspectiveVertical");
    if (verticalSlider) {
        verticalSlider.addEventListener("input", (e) => {
            const persp = window.perspectiveCanvasController._ensurePerspectiveSettings();
            persp.verticalValue = parseFloat(e.target.value) || 0;
            _applyKeystoneSliders();
            const label = verticalSlider.closest(".pc-row").querySelector(".control-value");
            if (label) label.textContent = persp.verticalValue;
        });
        verticalSlider.addEventListener("change", () => _savePerspectiveState());
    }

    const horizontalSlider = container.querySelector("#perspectiveHorizontal");
    if (horizontalSlider) {
        horizontalSlider.addEventListener("input", (e) => {
            const persp = window.perspectiveCanvasController._ensurePerspectiveSettings();
            persp.horizontalValue = parseFloat(e.target.value) || 0;
            _applyKeystoneSliders();
            const label = horizontalSlider.closest(".pc-row").querySelector(".control-value");
            if (label) label.textContent = persp.horizontalValue;
        });
        horizontalSlider.addEventListener("change", () => _savePerspectiveState());
    }
}

window.initPerspectiveController = initPerspectiveController;
window.renderPerspectivePanel = renderPerspectivePanel;
