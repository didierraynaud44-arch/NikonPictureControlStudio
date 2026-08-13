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
                <button class="btn-remove-mask" data-mask-id="${m.id}" title="Supprimer">${window.lucideIconHtml("x", { size: 12 })}</button>
            </div>
        `).join("");

    container.innerHTML = `
        <h3>Masques locaux</h3>
        <p style="font-size:11px; color:#949ba4; margin-bottom:8px;">
            Retouche par zone (ne sera jamais exportée en NP3/NCP).
        </p>

        <div class="mask-toolbar">
            <button data-mask-tool="linear" title="Filtre gradué linéaire">${window.lucideIconHtml("ruler", { size: 14 })} Linéaire</button>
            <button data-mask-tool="radial" title="Filtre gradué radial">${window.lucideIconHtml("circle", { size: 14 })} Radial</button>
            <button data-mask-tool="brush" title="Pinceau">${window.lucideIconHtml("paintbrush", { size: 14 })} Pinceau</button>
        </div>

        <div class="mask-toolbar">
            <button data-mask-action="undo" title="Annuler (Ctrl+Z)" ${window.MasksManager.canUndo() ? "" : "disabled"}>${window.lucideIconHtml("undo-2", { size: 14 })} Annuler</button>
            <button data-mask-action="redo" title="Rétablir (Ctrl+Maj+Z)" ${window.MasksManager.canRedo() ? "" : "disabled"}>${window.lucideIconHtml("redo-2", { size: 14 })} Rétablir</button>
        </div>

        ${window.maskCanvasController && window.maskCanvasController.mode === "brush" ? `
        <div class="mask-brush-settings" style="background:#1e1f22; padding:8px 10px; border-radius:6px; border:1px solid #35373c; margin-bottom:10px;">
            <div class="pc-row" style="margin-bottom:6px;">
                <label>Taille du pinceau : <span class="control-value" data-value-for="brush-size">${Math.round(window.maskCanvasController.brushSize * 100)}%</span></label>
                <input type="range" class="pc-slider" data-mask-field="brushSize" min="0.01" max="0.15" step="0.005" value="${window.maskCanvasController.brushSize}">
            </div>
            <div class="pc-row">
                <label>Dureté : <span class="control-value" data-value-for="brush-hardness">${Math.round(window.maskCanvasController.brushHardness * 100)}%</span></label>
                <input type="range" class="pc-slider" data-mask-field="brushHardness" min="0" max="1" step="0.05" value="${window.maskCanvasController.brushHardness}">
            </div>
        </div>
        ` : ""}

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
            ${window.lucideIconHtml("target", { size: 13 })} Réglages LOCAUX — s'appliquent uniquement à : <b>${window.MasksManager.displayName(activeMask)}</b>
        </div>
        <div class="mask-detail">
            <div class="pc-row" style="margin-bottom:8px;">
                <label>Opacité globale : <span class="control-value" data-value-for="mask-opacity">${Math.round((activeMask.opacity ?? 1) * 100)}%</span></label>
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

            // Un seul outil d'édition locale actif à la fois : annule le tampon
            // de duplication et la Gomme couleur du module Monochrome s'ils
            // étaient en cours, pour éviter que plusieurs contrôleurs se
            // disputent les clics sur le canvas.
            if (window.retouchCanvasController) window.retouchCanvasController.cancelMode();
            if (typeof window.renderRetouchPanel === "function") window.renderRetouchPanel();
            if (window.monochromeMaskController) window.monochromeMaskController.cancelMode();
            if (typeof window.renderMonochromePanel === "function") window.renderMonochromePanel();

            // Nécessaire pour afficher immédiatement les réglages du pinceau
            // (taille/dureté) dès la sélection de l'outil, avant le premier trait.
            renderMasksPanel();
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

    container.querySelectorAll("[data-mask-action]").forEach(btn => {
        btn.addEventListener("click", () => {
            const action = btn.dataset.maskAction;
            if (action === "undo") window.MasksManager.undo();
            else if (action === "redo") window.MasksManager.redo();
            renderMasksPanel();
            if (window.imageProcessor) window.imageProcessor.render();
        });
    });

    // Curseur d'opacité globale : propriété séparée des réglages (adjustments),
    // gérée par updateMaskOpacity() plutôt que updateMaskAdjustments().
    const opacitySlider = container.querySelector('[data-mask-field="opacity"]');
    if (opacitySlider) {
        opacitySlider.addEventListener("mousedown", () => window.MasksManager.beginAction());
        opacitySlider.addEventListener("input", () => {
            const activeMask = window.MasksManager.getActiveMask();
            if (!activeMask) return;
            const value = Number(opacitySlider.value);
            window.MasksManager.updateMaskOpacity(activeMask.id, value);

            const label = container.querySelector('[data-value-for="mask-opacity"]');
            if (label) label.textContent = Math.round(value * 100) + "%";

            if (window.imageProcessor) window.imageProcessor.render();
        });
    }

    // Taille et dureté du pinceau : propriétés du contrôleur (transitoires, pas
    // d'un masque en particulier), utilisées pour le prochain trait dessiné.
    const brushSizeSlider = container.querySelector('[data-mask-field="brushSize"]');
    if (brushSizeSlider) {
        brushSizeSlider.addEventListener("input", () => {
            const value = Number(brushSizeSlider.value);
            if (window.maskCanvasController) window.maskCanvasController.brushSize = value;

            const label = container.querySelector('[data-value-for="brush-size"]');
            if (label) label.textContent = Math.round(value * 100) + "%";

            // Redessine l'aperçu du cercle de pinceau à sa nouvelle taille, même
            // sans mouvement de souris (curseur déjà positionné sur la photo).
            if (window.imageProcessor) window.imageProcessor.renderMaskOverlay();
        });
    }

    const brushHardnessSlider = container.querySelector('[data-mask-field="brushHardness"]');
    if (brushHardnessSlider) {
        brushHardnessSlider.addEventListener("input", () => {
            const value = Number(brushHardnessSlider.value);
            if (window.maskCanvasController) window.maskCanvasController.brushHardness = value;

            const label = container.querySelector('[data-value-for="brush-hardness"]');
            if (label) label.textContent = Math.round(value * 100) + "%";
        });
    }
}

window.initMasksController = initMasksController;
window.renderMasksPanel = renderMasksPanel;