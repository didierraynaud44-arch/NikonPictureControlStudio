/*=========================================================
    Nikon Picture Control Studio - Panneau Masques (Studio)
=========================================================*/

if (typeof window.maskCanvasController === "undefined") {
    window.maskCanvasController = null;
}

const AI_MASK_TYPES = ["sky", "subject", "background"];

// 🔹 État d'un calcul IA en cours (Ciel/Sujet/Arrière-plan) : désactive les
// boutons IA et affiche un indicateur pendant l'inférence (souvent plusieurs
// secondes, voir AIMaskEngine.js), pour éviter un double déclenchement.
let aiMaskBusy = false;
let aiMaskBusyLabel = "";

/** Image ACTUELLEMENT affichée dans le Studio (RGBA), source pour les
 * segmentations IA — voir AIMaskEngine.js. */
function getCurrentStudioImageData() {
    const canvas = window.imageProcessor && window.imageProcessor.display && window.imageProcessor.display.offscreenCanvas;
    if (!canvas || !canvas.width || !canvas.height) return null;
    return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
}

async function runSkyMask() {
    if (aiMaskBusy || !window.AIMaskEngine || !window.MasksManager || !window.MaskEngine) return;
    const imageData = getCurrentStudioImageData();
    if (!imageData) return;

    aiMaskBusy = true;
    aiMaskBusyLabel = "Analyse du ciel en cours...";
    renderMasksPanel();

    try {
        const alpha = await window.AIMaskEngine.segmentSky(imageData);
        const alphaMapDataUrl = window.MaskEngine.encodeAlphaToDataUrl(alpha, imageData.width, imageData.height);
        const newMask = window.MasksManager.createMask("sky", { alphaMapDataUrl, invert: false, threshold: 0.5, softness: 1 });
        // 🔹 Visible dès la création : la première chose qu'on veut voir après un
        // calcul IA, c'est justement la zone détectée (le bouton œil permet
        // ensuite de la masquer pendant l'ajustement des curseurs si besoin).
        window.MasksManager.setMaskOverlayVisible(newMask.id, true);
        if (window.imageProcessor) window.imageProcessor.render();
    } catch (err) {
        console.error("❌ Erreur segmentation Ciel :", err);
        alert("Impossible de détecter le ciel sur cette photo.");
    } finally {
        aiMaskBusy = false;
        aiMaskBusyLabel = "";
        renderMasksPanel();
    }
}

async function runSubjectMaskAtPoint(x, y) {
    if (aiMaskBusy || !window.AIMaskEngine || !window.MasksManager || !window.MaskEngine) return;
    const imageData = getCurrentStudioImageData();
    if (!imageData) return;

    aiMaskBusy = true;
    aiMaskBusyLabel = "Analyse du sujet en cours...";
    renderMasksPanel();

    try {
        const alpha = await window.AIMaskEngine.segmentSubjectAtPoint(imageData, x, y);
        const alphaMapDataUrl = window.MaskEngine.encodeAlphaToDataUrl(alpha, imageData.width, imageData.height);
        const newMask = window.MasksManager.createMask("subject", { alphaMapDataUrl, invert: false, threshold: 0.5, softness: 1 });
        window.MasksManager.setMaskOverlayVisible(newMask.id, true);
        if (window.imageProcessor) window.imageProcessor.render();
    } catch (err) {
        console.error("❌ Erreur segmentation Sujet :", err);
        alert("Impossible de détecter un sujet à cet endroit.");
    } finally {
        aiMaskBusy = false;
        aiMaskBusyLabel = "";
        renderMasksPanel();
    }
}

function armSubjectPickMode() {
    if (aiMaskBusy || !window.imageProcessor) return;
    initMasksController(window.imageProcessor);
    if (!window.maskCanvasController) return;

    window.maskCanvasController.startNewMask("ai-subject");
    window.maskCanvasController.onAiSubjectPick = (x, y) => { runSubjectMaskAtPoint(x, y); };

    // Un seul outil d'édition locale actif à la fois (voir data-mask-tool).
    if (window.retouchCanvasController) window.retouchCanvasController.cancelMode();
    if (typeof window.renderRetouchPanel === "function") window.renderRetouchPanel();
    if (window.monochromeMaskController) window.monochromeMaskController.cancelMode();
    if (typeof window.renderMonochromePanel === "function") window.renderMonochromePanel();

    renderMasksPanel();
}

async function runBackgroundMask() {
    if (aiMaskBusy || !window.MasksManager || !window.MaskEngine) return;

    const masks = window.MasksManager.getMasks();
    const lastSubject = masks.slice().reverse().find(m => m.type === "subject" && m.geometry && m.geometry.alphaMapDataUrl);
    if (!lastSubject) {
        alert('Utilise d\'abord "Sujet" pour détecter un sujet sur cette photo.');
        return;
    }

    const imageData = getCurrentStudioImageData();
    if (!imageData) return;

    aiMaskBusy = true;
    aiMaskBusyLabel = "Inversion du sujet en arrière-plan...";
    renderMasksPanel();

    try {
        // 🔹 Pas de nouveau calcul IA : inversion (1 - alpha) du masque "subject"
        // le plus récent, décodé puis ré-encodé en sa propre carte indépendante
        // (voir MaskEngine.decodeAlphaMapDataUrl/encodeAlphaToDataUrl).
        const subjectAlpha = await window.MaskEngine.decodeAlphaMapDataUrl(
            lastSubject.geometry.alphaMapDataUrl, imageData.width, imageData.height
        );
        const backgroundAlpha = new Float32Array(subjectAlpha.length);
        for (let i = 0; i < subjectAlpha.length; i++) backgroundAlpha[i] = 1 - subjectAlpha[i];

        const alphaMapDataUrl = window.MaskEngine.encodeAlphaToDataUrl(backgroundAlpha, imageData.width, imageData.height);
        const newMask = window.MasksManager.createMask("background", { alphaMapDataUrl, invert: false, threshold: 0.5, softness: 1 });
        window.MasksManager.setMaskOverlayVisible(newMask.id, true);
        if (window.imageProcessor) window.imageProcessor.render();
    } catch (err) {
        console.error("❌ Erreur inversion Arrière-plan :", err);
    } finally {
        aiMaskBusy = false;
        aiMaskBusyLabel = "";
        renderMasksPanel();
    }
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
                ${AI_MASK_TYPES.includes(m.type) ? `
                <button class="btn-toggle-overlay ${m.showOverlay ? "active" : ""}" data-mask-id="${m.id}" title="${m.showOverlay ? "Masquer la zone sélectionnée" : "Afficher la zone sélectionnée"}">${window.lucideIconHtml(m.showOverlay ? "eye" : "eye-off", { size: 12 })}</button>
                ` : ""}
                <button class="btn-invert-mask ${m.geometry && m.geometry.invert ? "active" : ""}" data-mask-id="${m.id}" title="Inverser la sélection">${window.lucideIconHtml("contrast", { size: 12 })}</button>
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
            <button data-mask-ai-tool="sky" title="Détecte automatiquement le ciel (IA)" ${aiMaskBusy ? "disabled" : ""}>${window.lucideIconHtml("cloud", { size: 14 })} Ciel</button>
            <button data-mask-ai-tool="subject" title="Clique sur un sujet pour le détecter (IA)" ${aiMaskBusy ? "disabled" : ""}>${window.lucideIconHtml("scan-face", { size: 14 })} Sujet</button>
            <button data-mask-ai-tool="background" title="Inverse le dernier masque Sujet" ${aiMaskBusy ? "disabled" : ""}>${window.lucideIconHtml("layers", { size: 14 })} Arrière-plan</button>
        </div>

        ${aiMaskBusy ? `
        <p style="font-size:11px; color:#8ab4f8; display:flex; align-items:center; gap:6px; margin: -4px 0 10px;">
            ${window.lucideIconHtml("loader-circle", { size: 13, className: "icon-spin" })} ${aiMaskBusyLabel}
        </p>
        ` : (window.maskCanvasController && window.maskCanvasController.mode === "ai-subject" ? `
        <p style="font-size:11px; color:#8ab4f8; margin: -4px 0 10px;">
            Clique sur la photo pour détecter le sujet à cet endroit.
        </p>
        ` : "")}

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
            ${AI_MASK_TYPES.includes(activeMask.type) ? `
            <div class="mask-ai-controls" style="background:#1e1f22; padding:8px 10px; border-radius:6px; border:1px solid #35373c; margin-bottom:10px;">
                <div class="pc-row" style="margin-bottom:6px;">
                    <label>Seuil : <span class="control-value" data-value-for="mask-threshold">${Math.round((activeMask.geometry.threshold ?? 0.5) * 100)}%</span></label>
                    <input type="range" class="pc-slider" data-mask-field="threshold" min="0" max="1" step="0.01" value="${activeMask.geometry.threshold ?? 0.5}">
                </div>
                <div class="pc-row">
                    <label>Adoucissement : <span class="control-value" data-value-for="mask-softness">${Math.round((activeMask.geometry.softness ?? 1) * 100)}%</span></label>
                    <input type="range" class="pc-slider" data-mask-field="softness" min="0" max="1" step="0.01" value="${activeMask.geometry.softness ?? 1}">
                </div>
            </div>
            ` : ""}
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

    container.querySelectorAll("[data-mask-ai-tool]").forEach(btn => {
        btn.addEventListener("click", () => {
            const tool = btn.dataset.maskAiTool;
            if (tool === "sky") runSkyMask();
            else if (tool === "subject") armSubjectPickMode();
            else if (tool === "background") runBackgroundMask();
        });
    });

    container.querySelectorAll(".mask-item").forEach(item => {
        item.addEventListener("click", (e) => {
            if (e.target.classList.contains("mask-toggle") || e.target.classList.contains("btn-remove-mask") || e.target.classList.contains("btn-invert-mask") || e.target.classList.contains("btn-toggle-overlay")) return;
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

    // 🔹 "Inverser la sélection" : bascule mask.geometry.invert, commun à TOUS
    // les types de masques (Linéaire/Radial/Pinceau le supportaient déjà via
    // MaskEngine._invert(), Ciel/Sujet/Arrière-plan viennent de l'acquérir
    // aussi, voir MaskEngine.computeAiAlpha).
    container.querySelectorAll(".btn-invert-mask").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = btn.dataset.maskId;
            const mask = window.MasksManager.getMask(id);
            if (!mask) return;
            window.MasksManager.beginAction();
            window.MasksManager.updateMaskGeometry(id, { invert: !mask.geometry.invert });
            renderMasksPanel();
            if (window.imageProcessor) window.imageProcessor.render();
        });
    });

    // 🔹 "Afficher/masquer la zone sélectionnée" (masques IA) : simple aperçu,
    // pas un réglage — ne touche que l'overlay, jamais le rendu réel de
    // l'image (voir MasksManager.setMaskOverlayVisible, sans undo/redo).
    container.querySelectorAll(".btn-toggle-overlay").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = btn.dataset.maskId;
            window.MasksManager.setMaskOverlayVisible(id, !window.MasksManager.isMaskOverlayVisible(id));
            renderMasksPanel();
            if (window.imageProcessor) window.imageProcessor.renderMaskOverlay();
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

    // 🔹 Seuil/Adoucissement (masques IA uniquement) : recentrent la
    // probabilité brute stockée par le masque sur un seuil réglable, avec une
    // largeur d'adoucissement réglable (voir MaskEngine._applyThresholdSoftness).
    // Stockés dans mask.geometry (comme "invert"), PAS dans adjustments : ce
    // sont des réglages de la ZONE du masque, pas de l'effet appliqué dessus.
    ["threshold", "softness"].forEach(field => {
        const slider = container.querySelector(`[data-mask-field="${field}"]`);
        if (!slider) return;
        slider.addEventListener("mousedown", () => window.MasksManager.beginAction());
        slider.addEventListener("input", () => {
            const activeMask = window.MasksManager.getActiveMask();
            if (!activeMask) return;
            const value = Number(slider.value);
            window.MasksManager.updateMaskGeometry(activeMask.id, { [field]: value });

            const label = container.querySelector(`[data-value-for="mask-${field}"]`);
            if (label) label.textContent = Math.round(value * 100) + "%";

            if (renderTimer) clearTimeout(renderTimer);
            renderTimer = setTimeout(() => {
                if (window.imageProcessor) window.imageProcessor.render();
            }, 30);
        });
    });

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