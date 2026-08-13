/*=========================================================
    Pixel RAW - Panneau Monochrome (Studio)
    Mixeur N&B 8 canaux, Lumière tamisée, Courbe de contraste, Dodge & Burn,
    Gomme locale (réduction ciblée d'UN réglage, par zone peinte — l'image
    reste N&B partout). Indépendant du profil Nikon Monochrome et des
    systèmes de masques/retouche, mais suit le même modèle d'historique/
    persistance qu'eux (voir MonochromeManager.js).
=========================================================*/

(function () {

    // Libellés affichés pour les 10 cibles de la Gomme locale (mêmes clés
    // que MonochromeManager.ERASE_TARGETS).
    const ERASE_TARGET_LABELS = {
        red: "Rouge", orange: "Orange", yellow: "Jaune", green: "Vert",
        cyan: "Cyan", blue: "Bleu", violet: "Violet", magenta: "Magenta",
        dodgeBurn: "Dodge & Burn", punch: "Punch"
    };

    /**
     * Initialise (ou réattache) le contrôleur de la Gomme locale — même
     * structure que initMasksController()/initRetouchController(), voir
     * masksPanel.js/retouchPanel.js.
     */
    function initMonochromeMaskController(imageProcessor) {
        if (!imageProcessor) return;

        if (!window.monochromeMaskController) {
            window.monochromeMaskController = new MonochromeMaskCanvasController(imageProcessor);
        } else {
            window.monochromeMaskController.imageProcessor = imageProcessor;
            window.monochromeMaskController._bindEvents();
        }

        imageProcessor.monochromeMaskController = window.monochromeMaskController;

        window.monochromeMaskController.onEraseChange = () => {
            renderMonochromePanel();
            _saveMonoState();
        };
    }

    function fieldRow(label, field, value, min, max, step) {
        return window.createSlider ? window.createSlider(label, field, value, min, max, step) : "";
    }

    function renderMonochromePanel() {
        const container = document.getElementById("monochromePanelStatus");
        if (!container || typeof window.MonochromeManager === "undefined") return;

        const s = window.MonochromeManager.getSettings();
        const enabled = !!s.monoMixerEnabled;

        const eraseController = window.monochromeMaskController;
        const eraseToolActive = !!(eraseController && eraseController.mode === "erase");
        const eraseBrushSize = eraseController ? eraseController.brushSize : 0.05;
        const eraseBrushHardness = eraseController ? eraseController.brushHardness : 0.5;
        const eraseTarget = (eraseController && eraseController.currentTarget) || "red";
        const eraseIntensity = window.MonochromeManager.getEraseIntensity(eraseTarget);

        container.innerHTML = `
        <h3>Monochrome</h3>
        <p style="font-size:11px; color:#949ba4; margin-bottom:8px;">
            Mixeur N&amp;B par canaux, Lumière tamisée, courbe de contraste et
            Dodge &amp; Burn — module indépendant, applicable à n'importe quelle photo.
        </p>

        <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; margin-bottom:8px;">
            <input type="checkbox" data-mono-toggle ${enabled ? "checked" : ""}>
            Activer le module Monochrome
        </label>

        <div class="mask-toolbar" style="margin-bottom:10px;">
            <button data-mono-action="undo" title="Annuler (Ctrl+Z)" ${window.MonochromeManager.canUndo() ? "" : "disabled"}>${window.lucideIconHtml("undo-2", { size: 14 })} Annuler</button>
            <button data-mono-action="redo" title="Rétablir (Ctrl+Maj+Z)" ${window.MonochromeManager.canRedo() ? "" : "disabled"}>${window.lucideIconHtml("redo-2", { size: 14 })} Rétablir</button>
            <button data-mono-action="reset" title="Réinitialiser le module">${window.lucideIconHtml("rotate-ccw", { size: 14 })} Réinitialiser</button>
        </div>

        ${enabled ? `
        <div class="mono-body">
            <h4 style="font-size:12px; color:#dbdee1; margin:0 0 6px;">Mixeur N&amp;B</h4>
            ${fieldRow("Rouge", "monoMixerRed", s.monoMixerRed, -100, 200, 1)}
            ${fieldRow("Orange", "monoMixerOrange", s.monoMixerOrange, -100, 200, 1)}
            ${fieldRow("Jaune", "monoMixerYellow", s.monoMixerYellow, -100, 200, 1)}
            ${fieldRow("Vert", "monoMixerGreen", s.monoMixerGreen, -100, 200, 1)}
            ${fieldRow("Cyan", "monoMixerCyan", s.monoMixerCyan, -100, 200, 1)}
            ${fieldRow("Bleu", "monoMixerBlue", s.monoMixerBlue, -100, 200, 1)}
            ${fieldRow("Violet", "monoMixerViolet", s.monoMixerViolet, -100, 200, 1)}
            ${fieldRow("Magenta", "monoMixerMagenta", s.monoMixerMagenta, -100, 200, 1)}

            <h4 style="font-size:12px; color:#dbdee1; margin:14px 0 6px; border-top:1px solid #333; padding-top:10px;">Punch (auto-fusion)</h4>
            ${fieldRow("Lumière tamisée", "softLightIntensity", s.softLightIntensity, 0, 100, 1)}
            ${fieldRow("Courbe de contraste", "contrastCurveIntensity", s.contrastCurveIntensity, 0, 100, 1)}

            <h4 style="font-size:12px; color:#dbdee1; margin:14px 0 6px; border-top:1px solid #333; padding-top:10px;">Dodge &amp; Burn</h4>
            ${fieldRow("Blancs (éclaircir)", "dodgeBurnWhite", s.dodgeBurnWhite, 0, 100, 1)}
            ${fieldRow("Noirs (assombrir)", "dodgeBurnBlack", s.dodgeBurnBlack, 0, 100, 1)}

            <h4 style="font-size:12px; color:#dbdee1; margin:14px 0 6px; border-top:1px solid #333; padding-top:10px;">Gomme locale</h4>
            <p style="font-size:11px; color:#949ba4; margin:0 0 8px;">
                Peins pour réduire localement UN réglage ciblé — l'image reste N&amp;B partout.
            </p>
            <div class="pc-row" style="margin-bottom:8px;">
                <label style="font-size:11px; color:#aaa; display:block; margin-bottom:4px;">Cible :</label>
                <select data-mono-erase-target style="width:100%; background:#171717; border:1px solid #444; color:#fff; padding:6px; border-radius:4px; font-size:12px;">
                    ${Object.entries(ERASE_TARGET_LABELS).map(([key, label]) =>
                        `<option value="${key}" ${key === eraseTarget ? "selected" : ""}>${label}</option>`
                    ).join("")}
                </select>
            </div>
            <div class="mask-toolbar" style="margin-bottom:8px;">
                <button data-mono-erase-action="toggle-brush" class="${eraseToolActive ? "active" : ""}">${window.lucideIconHtml("paintbrush", { size: 14 })} ${eraseToolActive ? "Désactiver le pinceau" : "Activer le pinceau"}</button>
                <button data-mono-erase-action="reset-target" title="Réinitialiser cette cible">${window.lucideIconHtml("rotate-ccw", { size: 14 })} Réinitialiser cette cible</button>
                <button data-mono-erase-action="reset-all" title="Tout réinitialiser">${window.lucideIconHtml("trash-2", { size: 14 })} Tout réinitialiser</button>
            </div>
            ${eraseToolActive ? `
            <div class="mask-brush-settings" style="background:#1e1f22; padding:8px 10px; border-radius:6px; border:1px solid #35373c; margin-bottom:10px;">
                <div class="pc-row" style="margin-bottom:6px;">
                    <label>Taille du pinceau : <span class="control-value" data-value-for="erase-brush-size">${Math.round(eraseBrushSize * 100)}%</span></label>
                    <input type="range" class="pc-slider" data-mono-erase-field="brushSize" min="0.01" max="0.15" step="0.005" value="${eraseBrushSize}">
                </div>
                <div class="pc-row">
                    <label>Dureté : <span class="control-value" data-value-for="erase-brush-hardness">${Math.round(eraseBrushHardness * 100)}%</span></label>
                    <input type="range" class="pc-slider" data-mono-erase-field="brushHardness" min="0" max="1" step="0.05" value="${eraseBrushHardness}">
                </div>
            </div>
            ` : ""}
            <div class="pc-row" data-row="eraseIntensity">
                <div class="pc-label">
                    <span>Intensité de la gomme (${ERASE_TARGET_LABELS[eraseTarget]})</span>
                    <span class="control-value" data-value-for="erase-intensity">${eraseIntensity}</span>
                </div>
                <input class="pc-slider" data-mono-erase-field="intensity" type="range" min="0" max="100" step="1" value="${eraseIntensity}">
            </div>
        </div>
        ` : `
        <p style="font-size:11px; color:#666; font-style:italic; margin:0;">
            Active le module pour régler le mixeur, la Lumière tamisée et le Dodge &amp; Burn.
        </p>
        `}
        `;

        _bindMonochromePanelEvents(container);
    }

    function _saveMonoState() {
        if (typeof window.saveCurrentPhotoSettingsToCatalog === "function") {
            window.saveCurrentPhotoSettingsToCatalog();
        }
    }

    function _renderImage() {
        if (window.imageProcessor) window.imageProcessor.render();
    }

    function _bindMonochromePanelEvents(container) {
        const toggle = container.querySelector("[data-mono-toggle]");
        if (toggle) {
            toggle.addEventListener("change", () => {
                window.MonochromeManager.beginAction();
                window.MonochromeManager.updateSettings({ monoMixerEnabled: toggle.checked });

                // Le module désactivé masque la section Gomme : coupe aussi le
                // pinceau s'il était actif, pour ne pas le laisser intercepter
                // les clics sur le canvas sans contrôle visible à l'écran.
                if (!toggle.checked && window.monochromeMaskController) {
                    window.monochromeMaskController.cancelMode();
                }

                renderMonochromePanel();
                _renderImage();
                _saveMonoState();
            });
        }

        container.querySelectorAll("[data-mono-action]").forEach(btn => {
            btn.addEventListener("click", () => {
                const action = btn.dataset.monoAction;
                if (action === "undo") window.MonochromeManager.undo();
                else if (action === "redo") window.MonochromeManager.redo();
                else if (action === "reset") window.MonochromeManager.resetSettings();
                renderMonochromePanel();
                _renderImage();
                _saveMonoState();
            });
        });

        let renderTimer = null;
        let saveTimer = null;

        container.querySelectorAll(".mono-body .pc-slider[data-field]").forEach(slider => {
            slider.addEventListener("mousedown", () => window.MonochromeManager.beginAction());

            slider.addEventListener("input", () => {
                const value = Number(slider.value);
                const label = container.querySelector(`[data-value-for="${slider.dataset.field}"]`);
                if (label) label.textContent = value;

                window.MonochromeManager.updateSettings({ [slider.dataset.field]: value });

                if (renderTimer) clearTimeout(renderTimer);
                renderTimer = setTimeout(_renderImage, 30);

                if (saveTimer) clearTimeout(saveTimer);
                saveTimer = setTimeout(_saveMonoState, 200);
            });
        });

        const eraseToggleBtn = container.querySelector('[data-mono-erase-action="toggle-brush"]');
        if (eraseToggleBtn) {
            eraseToggleBtn.addEventListener("click", () => {
                if (window.imageProcessor && typeof window.initMonochromeMaskController === "function") {
                    window.initMonochromeMaskController(window.imageProcessor);
                }
                if (window.monochromeMaskController) {
                    if (window.monochromeMaskController.mode === "erase") {
                        window.monochromeMaskController.cancelMode();
                    } else {
                        window.monochromeMaskController.startTool();

                        // Un seul outil d'édition locale actif à la fois : coupe
                        // les Masques et le Tampon pour éviter que plusieurs
                        // contrôleurs se disputent les clics sur le canvas.
                        if (window.MasksManager) window.MasksManager.setActiveMask(null);
                        if (window.maskCanvasController) window.maskCanvasController.cancelMode();
                        if (window.retouchCanvasController) window.retouchCanvasController.cancelMode();
                        if (typeof window.renderMasksPanel === "function") window.renderMasksPanel();
                        if (typeof window.renderRetouchPanel === "function") window.renderRetouchPanel();
                    }
                }
                renderMonochromePanel();
            });
        }

        const eraseTargetSelect = container.querySelector("[data-mono-erase-target]");
        if (eraseTargetSelect) {
            eraseTargetSelect.addEventListener("change", () => {
                if (window.monochromeMaskController) {
                    window.monochromeMaskController.currentTarget = eraseTargetSelect.value;
                }
                // Change l'affichage (intensité de LA cible sélectionnée, historique
                // des traits séparé) sans modifier ni annuler quoi que ce soit.
                renderMonochromePanel();
            });
        }

        const eraseResetTargetBtn = container.querySelector('[data-mono-erase-action="reset-target"]');
        if (eraseResetTargetBtn) {
            eraseResetTargetBtn.addEventListener("click", () => {
                const target = (window.monochromeMaskController && window.monochromeMaskController.currentTarget) || "red";
                window.MonochromeManager.resetEraseMask(target);
                renderMonochromePanel();
                _renderImage();
                _saveMonoState();
            });
        }

        const eraseResetAllBtn = container.querySelector('[data-mono-erase-action="reset-all"]');
        if (eraseResetAllBtn) {
            eraseResetAllBtn.addEventListener("click", () => {
                window.MonochromeManager.resetAllEraseMasks();
                renderMonochromePanel();
                _renderImage();
                _saveMonoState();
            });
        }

        const eraseIntensitySlider = container.querySelector('[data-mono-erase-field="intensity"]');
        if (eraseIntensitySlider) {
            eraseIntensitySlider.addEventListener("mousedown", () => window.MonochromeManager.beginAction());

            eraseIntensitySlider.addEventListener("input", () => {
                const value = Number(eraseIntensitySlider.value);
                const target = (window.monochromeMaskController && window.monochromeMaskController.currentTarget) || "red";
                window.MonochromeManager.setEraseIntensity(target, value);

                const label = container.querySelector('[data-value-for="erase-intensity"]');
                if (label) label.textContent = value;

                if (renderTimer) clearTimeout(renderTimer);
                renderTimer = setTimeout(_renderImage, 30);

                if (saveTimer) clearTimeout(saveTimer);
                saveTimer = setTimeout(_saveMonoState, 200);
            });
        }

        const eraseBrushSizeSlider = container.querySelector('[data-mono-erase-field="brushSize"]');
        if (eraseBrushSizeSlider) {
            eraseBrushSizeSlider.addEventListener("input", () => {
                const value = Number(eraseBrushSizeSlider.value);
                if (window.monochromeMaskController) window.monochromeMaskController.brushSize = value;

                const label = container.querySelector('[data-value-for="erase-brush-size"]');
                if (label) label.textContent = Math.round(value * 100) + "%";

                // Redessine l'aperçu du cercle à sa nouvelle taille tout de suite,
                // même sans mouvement de souris (curseur déjà positionné sur la photo).
                if (window.imageProcessor) window.imageProcessor.renderMaskOverlay();
            });
        }

        const eraseBrushHardnessSlider = container.querySelector('[data-mono-erase-field="brushHardness"]');
        if (eraseBrushHardnessSlider) {
            eraseBrushHardnessSlider.addEventListener("input", () => {
                const value = Number(eraseBrushHardnessSlider.value);
                if (window.monochromeMaskController) window.monochromeMaskController.brushHardness = value;

                const label = container.querySelector('[data-value-for="erase-brush-hardness"]');
                if (label) label.textContent = Math.round(value * 100) + "%";
            });
        }
    }

    window.renderMonochromePanel = renderMonochromePanel;
    window.initMonochromeMaskController = initMonochromeMaskController;

})();
