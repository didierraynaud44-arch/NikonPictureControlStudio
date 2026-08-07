/*=========================================================
    Nikon Picture Control Studio - Panneau Masques (Studio)
=========================================================*/

let maskCanvasController = null;

function initMasksController(imageProcessor) {
    if (!imageProcessor || maskCanvasController) return;

    imageProcessor.enableMasks = true;
    maskCanvasController = new MaskCanvasController(imageProcessor);
    imageProcessor.maskController = maskCanvasController;

    maskCanvasController.onMaskChange = () => {
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

function _getBrushHardness(mask) {
    const strokes = mask.geometry.strokes || [];
    for (const stroke of strokes) {
        if (stroke.length > 0 && typeof stroke[0].hardness === "number") {
            return stroke[0].hardness;
        }
    }
    return 0.5;
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

        <div class="pc-row" style="margin-bottom: 10px;">
            <label>
                <input type="checkbox" data-mask-action="toggle-overlay" ${window.imageProcessor?.showMaskOverlay !== false ? "checked" : ""}>
                Afficher le contour des masques (touche O)
            </label>
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
            <div class="pc-row" style="margin-bottom:8px;">
                <label><input type="checkbox" data-mask-field="invert" ${activeMask.geometry.invert ? "checked" : ""}> Inverser le masque</label>
            </div>
            ${activeMask.type === "radial" ? `
            <div class="pc-row" style="margin-bottom:8px;">
                <label>Contour (feather) : <span data-value-for="mask-feather">${Math.round((activeMask.geometry.feather ?? 0.5) * 100)}%</span></label>
                <input type="range" class="pc-slider" data-mask-field="feather" min="0" max="1" step="0.01" value="${activeMask.geometry.feather ?? 0.5}">
            </div>
            ` : ""}
            ${activeMask.type === "linear" ? `
            <div class="pc-row" style="margin-bottom:8px;">
                <label>Progressivité : <span data-value-for="mask-linear-feather">${(activeMask.geometry.feather ?? 1).toFixed(1)}×</span></label>
                <input type="range" class="pc-slider" data-mask-field="linear-feather" min="0.2" max="3" step="0.1" value="${activeMask.geometry.feather ?? 1}">
                <p style="font-size:10px; color:#666; margin-top:2px;">Plus bas = transition nette, plus haut = transition douce</p>
            </div>
            ` : ""}
            ${activeMask.type === "brush" ? `
            <div class="pc-row" style="margin-bottom:8px;">
                <label>Douceur du pinceau : <span data-value-for="mask-brush-hardness">${Math.round((1 - (_getBrushHardness(activeMask))) * 100)}%</span></label>
                <input type="range" class="pc-slider" data-mask-field="brush-softness" min="0" max="1" step="0.01" value="${1 - _getBrushHardness(activeMask)}">
                <p style="font-size:10px; color:#666; margin-top:2px;">S'applique à tout le trait déjà peint, et aux prochains traits</p>
            </div>
            ` : ""}
            ${buildMaskAdjustmentsHtml(activeMask)}
        </div>
        `}
    `;

    _bindMasksPanelEvents(container);
}

function _bindMasksPanelEvents(container) {
    container.querySelectorAll("[data-mask-tool]").forEach(btn => {
        btn.addEventListener("click", () => {
            if (window.imageProcessor) window.imageProcessor.enableMasks = true;
            if (!maskCanvasController && window.imageProcessor) {
                initMasksController(window.imageProcessor);
            }
            if (maskCanvasController) {
                maskCanvasController.startNewMask(btn.dataset.maskTool);
            }
        });
    });

    const undoBtn = container.querySelector('[data-mask-action="undo"]');
    if (undoBtn) {
        undoBtn.addEventListener("click", () => {
            if (window.MasksManager.undo()) {
                renderMasksPanel();
                if (window.imageProcessor) window.imageProcessor.render();
            }
        });
    }
    const redoBtn = container.querySelector('[data-mask-action="redo"]');
    if (redoBtn) {
        redoBtn.addEventListener("click", () => {
            if (window.MasksManager.redo()) {
                renderMasksPanel();
                if (window.imageProcessor) window.imageProcessor.render();
            }
        });
    }

    const overlayToggle = container.querySelector('[data-mask-action="toggle-overlay"]');
    if (overlayToggle) {
        overlayToggle.addEventListener("change", () => {
            if (window.imageProcessor) {
                window.imageProcessor.showMaskOverlay = overlayToggle.checked;
                window.imageProcessor.render();
            }
        });
    }

    container.querySelectorAll(".mask-item").forEach(item => {
        item.addEventListener("click", (e) => {
            if (e.target.classList.contains("mask-toggle") || e.target.classList.contains("btn-remove-mask")) return;
            window.MasksManager.setActiveMask(item.dataset.maskId);
            renderMasksPanel();
            if (window.imageProcessor) window.imageProcessor.render();
        });
    });

    container.querySelectorAll(".mask-toggle").forEach(cb => {
        cb.addEventListener("click", (e) => e.stopPropagation());
        cb.addEventListener("change", () => {
            window.MasksManager.toggleMask(cb.dataset.maskId);
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

    const opacitySlider = container.querySelector('[data-mask-field="opacity"]');
    if (opacitySlider) {
        opacitySlider.addEventListener("mousedown", () => window.MasksManager.beginAction());
        opacitySlider.addEventListener("input", () => {
            const activeMask = window.MasksManager.getActiveMask();
            if (!activeMask) return;
            window.MasksManager.updateMaskOpacity(activeMask.id, Number(opacitySlider.value));
            const label = container.querySelector('[data-value-for="mask-opacity"]');
            if (label) label.textContent = `${Math.round(Number(opacitySlider.value) * 100)}%`;
            if (window.imageProcessor) window.imageProcessor.render();
        });
    }

    const invertCheckbox = container.querySelector('[data-mask-field="invert"]');
    if (invertCheckbox) {
        invertCheckbox.addEventListener("change", () => {
            const activeMask = window.MasksManager.getActiveMask();
            if (!activeMask) return;
            window.MasksManager.beginAction();
            window.MasksManager.updateMaskGeometry(activeMask.id, { invert: invertCheckbox.checked });
            if (window.imageProcessor) window.imageProcessor.render();
        });
    }

    const featherSlider = container.querySelector('[data-mask-field="feather"]');
    if (featherSlider) {
        featherSlider.addEventListener("mousedown", () => window.MasksManager.beginAction());
        featherSlider.addEventListener("input", () => {
            const activeMask = window.MasksManager.getActiveMask();
            if (!activeMask) return;
            window.MasksManager.updateMaskGeometry(activeMask.id, { feather: Number(featherSlider.value) });
            const label = container.querySelector('[data-value-for="mask-feather"]');
            if (label) label.textContent = `${Math.round(Number(featherSlider.value) * 100)}%`;
            if (window.imageProcessor) window.imageProcessor.render();
        });
    }

    const linearFeatherSlider = container.querySelector('[data-mask-field="linear-feather"]');
    if (linearFeatherSlider) {
        linearFeatherSlider.addEventListener("mousedown", () => window.MasksManager.beginAction());
        linearFeatherSlider.addEventListener("input", () => {
            const activeMask = window.MasksManager.getActiveMask();
            if (!activeMask) return;
            const value = Number(linearFeatherSlider.value);
            window.MasksManager.updateMaskGeometry(activeMask.id, { feather: value });
            const label = container.querySelector('[data-value-for="mask-linear-feather"]');
            if (label) label.textContent = `${value.toFixed(1)}×`;
            if (window.imageProcessor) window.imageProcessor.render();
        });
    }

    const brushSoftnessSlider = container.querySelector('[data-mask-field="brush-softness"]');
    if (brushSoftnessSlider) {
        brushSoftnessSlider.addEventListener("mousedown", () => window.MasksManager.beginAction());
        brushSoftnessSlider.addEventListener("input", () => {
            const activeMask = window.MasksManager.getActiveMask();
            if (!activeMask) return;
            const softness = Number(brushSoftnessSlider.value);
            const hardness = 1 - softness;

            const strokes = (activeMask.geometry.strokes || []).map(stroke =>
                stroke.map(pt => ({ ...pt, hardness }))
            );
            window.MasksManager.updateMaskGeometry(activeMask.id, { strokes });

            if (maskCanvasController) maskCanvasController.brushHardness = hardness;

            const label = container.querySelector('[data-value-for="mask-brush-hardness"]');
            if (label) label.textContent = `${Math.round(softness * 100)}%`;
            if (window.imageProcessor) window.imageProcessor.render();
        });
    }

    let renderTimer = null;
    container.querySelectorAll(".mask-adjustments .pc-slider").forEach(slider => {
        slider.addEventListener("mousedown", () => window.MasksManager.beginAction());
        slider.addEventListener("input", () => {
            const value = Number(slider.value);
            const label = container.querySelector(`.mask-adjustments [data-value-for="${slider.dataset.field}"]`);
            if (label) label.textContent = value;

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

function _bindGlobalUndoShortcut() {
    if (window._maskUndoShortcutBound) return;
    window._maskUndoShortcutBound = true;

    document.addEventListener("keydown", (e) => {
        const isCtrlOrCmd = e.ctrlKey || e.metaKey;
        const tag = document.activeElement?.tagName;
        const inTextField = tag === "TEXTAREA" || (tag === "INPUT" && document.activeElement.type === "text");

        if (isCtrlOrCmd && e.key.toLowerCase() === "z") {
            if (inTextField) return;
            e.preventDefault();
            const didSomething = e.shiftKey ? window.MasksManager.redo() : window.MasksManager.undo();
            if (didSomething) {
                renderMasksPanel();
                if (window.imageProcessor) window.imageProcessor.render();
            }
            return;
        }

        if (!isCtrlOrCmd && e.key.toLowerCase() === "o" && !inTextField && window.imageProcessor) {
            e.preventDefault();
            window.imageProcessor.showMaskOverlay = !window.imageProcessor.showMaskOverlay;
            window.imageProcessor.render();
            renderMasksPanel();
        }
    });
}

window.initMasksController = initMasksController;
window.renderMasksPanel = renderMasksPanel;
_bindGlobalUndoShortcut();