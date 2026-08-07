/*=========================================================
    Nikon Picture Control Studio - Panneau Masques (Studio)
=========================================================*/

if (typeof window.maskCanvasController === "undefined") {
    window.maskCanvasController = null;
}

function initMasksController(imageProcessor) {
    if (!imageProcessor) return;

    imageProcessor.enableMasks = true;

    if (!window.maskCanvasController) {
        window.maskCanvasController = new MaskCanvasController(imageProcessor);
    } else {
        window.maskCanvasController.imageProcessor = imageProcessor;
        window.maskCanvasController._bindEvents(); // Force la réécoute du Canvas
    }

    imageProcessor.maskController = window.maskCanvasController;

    window.maskCanvasController.onMaskChange = () => {
        renderMasksPanel();
        imageProcessor.render();
    };
}

function fieldRow(label, field, value, min, max, step) {
    return window.createSlider ? window.createSlider(label, field, value, min, max, step) : "";
}

function buildMaskAdjustmentsHtml(mask) {
    const a = mask.adjustments || {};
    return `
        <div class="mask-adjustments">
            <h4>Exposition &amp; Niveaux</h4>
            ${fieldRow("Exposition (EV)", "exposure", a.exposure ?? 0, -3, 3, 0.1)}
            ${fieldRow("Point noir", "blackPoint", a.blackPoint ?? 0, 0, 250, 1)}
            ${fieldRow("Point blanc", "whitePoint", a.whitePoint ?? 255, 5, 255, 1)}

            <h4>Tonalité</h4>
            ${fieldRow("Contraste", "contrast", a.contrast ?? 0, -3, 3, 0.25)}
            ${fieldRow("Luminosité", "brightness", a.brightness ?? 0, -1.5, 1.5, 0.1)}
            ${fieldRow("Hautes lumières", "highlights", a.highlights ?? 0, -5, 5, 0.25)}
            ${fieldRow("Ombres", "shadows", a.shadows ?? 0, -5, 5, 0.25)}

            <h4>Couleur</h4>
            ${fieldRow("Saturation", "saturation", a.saturation ?? 0, -3, 3, 0.25)}
            ${fieldRow("Teinte", "hue", a.hue ?? 0, -3, 3, 0.25)}
            ${fieldRow("Vibrance", "vibrance", a.vibrance ?? 0, -5, 5, 0.25)}

            <h4>Détail</h4>
            ${fieldRow("Accentuation", "sharpening", a.sharpening ?? 0, -3, 9, 0.25)}
            ${fieldRow("Accentuation moyenne", "midRangeSharpening", a.midRangeSharpening ?? 0, -5, 5, 0.25)}
            ${fieldRow("Clarté", "clarity", a.clarity ?? 0, -5, 5, 0.25)}
            ${fieldRow("Correction du voile", "dehaze", a.dehaze ?? 0, 0, 10, 0.5)}
            ${fieldRow("Réduction du bruit", "denoise", a.denoise ?? 0, 0, 5, 0.5)}
            ${fieldRow("Vignettage", "vignette", a.vignette ?? 0, -5, 5, 0.25)}
        </div>
    `;
}

function renderMasksPanel() {
    const container = document.getElementById("masksPanelStatus");
    if (!container || typeof window.MasksManager === "undefined") return;

    const masks = window.MasksManager.getMasks();
    const activeMask = window.MasksManager.getActiveMask();

    const listHtml = masks.length === 0
        ? `<p style="color:#888; font-size:12px; font-style:italic; padding:8px 0;">Aucun masque. Utilise les boutons ci-dessus pour en créer un.</p>`
        : masks.map(m => `
            <div class="mask-item ${activeMask && activeMask.id === m.id ? "active" : ""}" data-mask-id="${m.id}">
                <input type="checkbox" class="mask-toggle" data-mask-id="${m.id}" ${m.enabled ? "checked" : ""}>
                <span class="mask-name" data-mask-id="${m.id}">${window.MasksManager.displayName(m)}</span>
                <button class="btn-remove-mask" data-mask-id="${m.id}" title="Supprimer">✕</button>
            </div>
        `).join("");

    container.innerHTML = `
        <h3>Masques locaux</h3>
        <p style="font-size:11px; color:#949ba4; margin-bottom:8px;">
            Retouche par zone (ne sera jamais exportée en NP3/NCP).
        </p>

        <div class="mask-toolbar">
            <button data-mask-tool="linear" title="Filtre gradué linéaire">📏 Linéaire</button>
            <button data-mask-tool="radial" title="Filtre gradué radial">⭕ Radial</button>
            <button data-mask-tool="brush" title="Pinceau">🖌️ Pinceau</button>
        </div>

        <div class="mask-toolbar">
            <button data-mask-action="undo" title="Annuler (Ctrl+Z)" ${window.MasksManager.canUndo() ? "" : "disabled"}>↶ Annuler</button>
            <button data-mask-action="redo" title="Rétablir (Ctrl+Maj+Z)" ${window.MasksManager.canRedo() ? "" : "disabled"}>↷ Rétablir</button>
        </div>

        <div class="mask-list">
            ${listHtml}
        </div>

        ${!activeMask ? `
        <p style="font-size:11px; color:#666; font-style:italic; margin-top:8px;">
            Sélectionne un masque ci-dessus pour éditer ses réglages locaux.
        </p>
        ` : `
        <hr style="border:0; border-top:1px solid #444; margin: 12px 0;">
        <div class="scope-banner scope-local">
            🎯 Réglages LOCAUX — s'appliquent uniquement à : <b>${window.MasksManager.displayName(activeMask)}</b>
        </div>
        <div class="mask-detail">
            <div class="pc-row" style="margin-bottom:8px;">
                <label>Opacité globale : <span data-value-for="mask-opacity">${Math.round((activeMask.opacity ?? 1) * 100)}%</span></label>
                <input type="range" class="pc-slider" data-mask-field="opacity" min="0" max="1" step="0.01" value="${activeMask.opacity ?? 1}">
            </div>
            ${buildMaskAdjustmentsHtml(activeMask)}
        </div>
        `}
    `;

    _bindMasksPanelEvents(container);
}

function _bindMasksPanelEvents(container) {
    container.querySelectorAll("[data-mask-tool]").forEach(btn => {
        btn.addEventListener("click", () => {
            if (window.imageProcessor) {
                initMasksController(window.imageProcessor);
            }
            if (window.maskCanvasController) {
                window.maskCanvasController.startNewMask(btn.dataset.maskTool);
            }
        });
    });

    container.querySelectorAll(".mask-item").forEach(item => {
        item.addEventListener("click", (e) => {
            if (e.target.classList.contains("mask-toggle") || e.target.classList.contains("btn-remove-mask")) return;
            window.MasksManager.setActiveMask(item.dataset.maskId);
            renderMasksPanel();
            if (window.imageProcessor) window.imageProcessor.render();
        });
    });

    container.querySelectorAll(".btn-remove-mask").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            window.MasksManager.removeMask(btn.dataset.maskId);
            renderMasksPanel();
            if (window.imageProcessor) window.imageProcessor.render();
        });
    });

    let renderTimer = null;
    container.querySelectorAll(".mask-adjustments .pc-slider").forEach(slider => {
        slider.addEventListener("mousedown", () => window.MasksManager.beginAction());
        slider.addEventListener("input", () => {
            const value = Number(slider.value);
            const activeMask = window.MasksManager.getActiveMask();
            if (!activeMask) return;
            window.MasksManager.updateMaskAdjustments(activeMask.id, { [slider.dataset.field]: value });

            if (renderTimer) clearTimeout(renderTimer);
            renderTimer = setTimeout(() => {
                if (window.imageProcessor) window.imageProcessor.render();
            }, 30);
        });
    });
}

window.initMasksController = initMasksController;
window.renderMasksPanel = renderMasksPanel;