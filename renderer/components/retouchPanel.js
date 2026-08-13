/*=========================================================
    Pixel RAW - Panneau Retouche (Tampon de duplication, Studio)
=========================================================*/

if (typeof window.retouchCanvasController === "undefined") {
    window.retouchCanvasController = null;
}

function initRetouchController(imageProcessor) {
    if (!imageProcessor) return;

    if (!window.retouchCanvasController) {
        window.retouchCanvasController = new RetouchCanvasController(imageProcessor);
    } else {
        window.retouchCanvasController.imageProcessor = imageProcessor;
        window.retouchCanvasController._bindEvents();
    }

    imageProcessor.retouchController = window.retouchCanvasController;

    window.retouchCanvasController.onRetouchChange = () => {
        renderRetouchPanel();
        imageProcessor.render();
        _saveRetouchState();
    };
}

function _saveRetouchState() {
    if (typeof window.saveCurrentPhotoSettingsToCatalog === "function") {
        window.saveCurrentPhotoSettingsToCatalog();
    }
}

function renderRetouchPanel() {
    const container = document.getElementById("retouchPanelStatus");
    if (!container || typeof window.RetouchManager === "undefined") return;

    const retouches = window.RetouchManager.getRetouches();
    const controller = window.retouchCanvasController;
    const toolActive = !!(controller && controller.mode === "heal");

    const listHtml = retouches.length === 0
        ? `<p style="color:#888; font-size:12px; font-style:italic; padding:8px 0;">Aucune retouche. Alt+clic (ou Ctrl+clic) pour définir la source, puis peins la zone à corriger.</p>`
        : retouches.map((r, i) => `
            <div class="mask-item" data-retouch-id="${r.id}">
                <span class="mask-name">Retouche ${i + 1}</span>
                <button class="btn-remove-mask" data-retouch-id="${r.id}" title="Supprimer">${window.lucideIconHtml("x", { size: 12 })}</button>
            </div>
        `).join("");

    container.innerHTML = `
        <h3>Tampon de duplication</h3>
        <p style="font-size:11px; color:#949ba4; margin-bottom:8px;">
            Corrige poussières, câbles, éléments indésirables — appliqué une fois, avant les réglages globaux.
        </p>

        <div class="mask-toolbar">
            <button data-retouch-tool="heal" class="${toolActive ? "active" : ""}" title="Tampon de duplication (fusion Poisson)">${window.lucideIconHtml("target", { size: 14 })} Tampon</button>
        </div>

        <div class="mask-toolbar">
            <button data-retouch-action="undo" title="Annuler (Ctrl+Z)" ${window.RetouchManager.canUndo() ? "" : "disabled"}>${window.lucideIconHtml("undo-2", { size: 14 })} Annuler</button>
            <button data-retouch-action="redo" title="Rétablir (Ctrl+Maj+Z)" ${window.RetouchManager.canRedo() ? "" : "disabled"}>${window.lucideIconHtml("redo-2", { size: 14 })} Rétablir</button>
        </div>

        ${toolActive ? `
        <div class="mask-brush-settings" style="background:#1e1f22; padding:8px 10px; border-radius:6px; border:1px solid #35373c; margin-bottom:10px;">
            <p style="font-size:11px; color:#ffd166; margin:0 0 8px;">
                Alt+clic (ou Ctrl+clic) : définit la source. Glisse ensuite pour peindre la correction.
            </p>
            <div class="pc-row" style="margin-bottom:6px;">
                <label>Taille du pinceau : <span class="control-value" data-value-for="retouch-brush-size">${Math.round(controller.brushSize * 100)}%</span></label>
                <input type="range" class="pc-slider" data-retouch-field="brushSize" min="0.01" max="0.15" step="0.005" value="${controller.brushSize}">
            </div>
            <div class="pc-row">
                <label>Dureté : <span class="control-value" data-value-for="retouch-brush-hardness">${Math.round(controller.brushHardness * 100)}%</span></label>
                <input type="range" class="pc-slider" data-retouch-field="brushHardness" min="0" max="1" step="0.05" value="${controller.brushHardness}">
            </div>
        </div>
        ` : ""}

        <div class="mask-list">
            ${listHtml}
        </div>
    `;

    _bindRetouchPanelEvents(container);
}

function _bindRetouchPanelEvents(container) {
    container.querySelectorAll("[data-retouch-tool]").forEach(btn => {
        btn.addEventListener("click", () => {
            if (window.imageProcessor) {
                initRetouchController(window.imageProcessor);
            }
            if (window.retouchCanvasController) {
                if (window.retouchCanvasController.mode === "heal") {
                    window.retouchCanvasController.cancelMode();
                } else {
                    window.retouchCanvasController.startTool();

                    // Un seul outil d'édition locale actif à la fois : désélectionne le
                    // masque actif et coupe la Gomme couleur pour ne pas les laisser
                    // intercepter les clics du tampon.
                    if (window.MasksManager) window.MasksManager.setActiveMask(null);
                    if (window.maskCanvasController) window.maskCanvasController.cancelMode();
                    if (typeof window.renderMasksPanel === "function") window.renderMasksPanel();
                    if (window.monochromeMaskController) window.monochromeMaskController.cancelMode();
                    if (typeof window.renderMonochromePanel === "function") window.renderMonochromePanel();
                }
            }
            renderRetouchPanel();
        });
    });

    container.querySelectorAll("[data-retouch-action]").forEach(btn => {
        btn.addEventListener("click", () => {
            const action = btn.dataset.retouchAction;
            if (action === "undo") window.RetouchManager.undo();
            else if (action === "redo") window.RetouchManager.redo();
            renderRetouchPanel();
            if (window.imageProcessor) window.imageProcessor.render();
            _saveRetouchState();
        });
    });

    container.querySelectorAll(".btn-remove-mask[data-retouch-id]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            window.RetouchManager.removeRetouch(btn.dataset.retouchId);
            renderRetouchPanel();
            if (window.imageProcessor) window.imageProcessor.render();
            _saveRetouchState();
        });
    });

    const sizeSlider = container.querySelector('[data-retouch-field="brushSize"]');
    if (sizeSlider) {
        sizeSlider.addEventListener("input", () => {
            const value = Number(sizeSlider.value);
            if (window.retouchCanvasController) window.retouchCanvasController.brushSize = value;

            const label = container.querySelector('[data-value-for="retouch-brush-size"]');
            if (label) label.textContent = Math.round(value * 100) + "%";

            if (window.imageProcessor) window.imageProcessor.renderMaskOverlay();
        });
    }

    const hardnessSlider = container.querySelector('[data-retouch-field="brushHardness"]');
    if (hardnessSlider) {
        hardnessSlider.addEventListener("input", () => {
            const value = Number(hardnessSlider.value);
            if (window.retouchCanvasController) window.retouchCanvasController.brushHardness = value;

            const label = container.querySelector('[data-value-for="retouch-brush-hardness"]');
            if (label) label.textContent = Math.round(value * 100) + "%";
        });
    }
}

window.initRetouchController = initRetouchController;
window.renderRetouchPanel = renderRetouchPanel;
