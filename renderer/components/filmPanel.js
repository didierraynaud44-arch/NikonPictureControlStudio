/*=========================================================
    Pixel RAW - Panneau Simulation Pellicule (Studio)
    Grain, halation, Hald-CLUT (réponse colorimétrique pellicule)
=========================================================*/

(function () {

    // 🔹 Préréglages Hald-CLUT intégrés (assets/hald-clut/bw, /color) : lus une
    // seule fois via IPC et mis en cache (contenu statique du disque, ne change
    // pas pendant la session). null = pas encore chargés, une requête est alors
    // lancée et le panneau se re-rend automatiquement à sa résolution.
    let presetsCache = null;
    let presetsLoading = false;

    function _ensurePresetsLoaded() {
        if (presetsCache || presetsLoading) return;
        if (!window.electronAPI || typeof window.electronAPI.listHaldClutPresets !== "function") return;

        presetsLoading = true;
        window.electronAPI.listHaldClutPresets()
            .then(result => {
                presetsCache = result && typeof result === "object" ? result : { bw: [], color: [] };
            })
            .catch(err => {
                console.error("❌ Erreur chargement préréglages Hald-CLUT :", err);
                presetsCache = { bw: [], color: [] };
            })
            .finally(() => {
                presetsLoading = false;
                renderFilmPanel();
            });
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    // Chemin absolu -> forme comparable indépendamment des séparateurs \ / et
    // de la casse (Windows n'est pas sensible à la casse sur le système de fichiers).
    function normalizePath(p) {
        return (p || "").toString().replace(/\\/g, "/").toLowerCase();
    }

    function buildPresetOptions(list, sectionLabel) {
        if (!list || !list.length) return "";

        const byBrand = new Map();
        for (const preset of list) {
            const brand = preset.brand || sectionLabel;
            if (!byBrand.has(brand)) byBrand.set(brand, []);
            byBrand.get(brand).push(preset);
        }

        let html = "";
        for (const [brand, presets] of byBrand) {
            html += `<optgroup label="${escapeHtml(sectionLabel)} — ${escapeHtml(brand)}">`;
            for (const preset of presets) {
                html += `<option value="${escapeHtml(preset.path)}">${escapeHtml(preset.name)}</option>`;
            }
            html += `</optgroup>`;
        }
        return html;
    }

    function fieldRow(label, field, value, min, max, step) {
        return window.createSlider ? window.createSlider(label, field, value, min, max, step) : "";
    }

    // Catégorie ("bw"/"color") d'un chemin de Hald-CLUT situé dans
    // assets/hald-clut/bw/ ou assets/hald-clut/color/ (comparaison via
    // normalizePath : insensible à la casse et aux séparateurs \ /). null si
    // le fichier est ailleurs sur le disque (LUT personnel) — dans ce cas
    // aucune catégorie n'est connue.
    function _haldClutCategoryFromPath(filePath) {
        const normalized = normalizePath(filePath);
        if (normalized.includes("/hald-clut/bw/")) return "bw";
        if (normalized.includes("/hald-clut/color/")) return "color";
        return null;
    }

    // Synchronise l'état du module Monochrome sur la catégorie d'un Hald-CLUT
    // qui vient d'être chargé — un geste PONCTUEL déclenché uniquement au
    // chargement d'un nouveau LUT reconnu (bw/color), jamais un lien permanent :
    // un changement manuel ultérieur du module Monochrome (même LUT toujours
    // chargé) n'est jamais écrasé par un rendu suivant. category=null (LUT hors
    // de assets/hald-clut/, ou déjà dans l'état voulu) : ne fait rien.
    function _syncMonochromeWithHaldCategory(category) {
        if (!category || typeof window.MonochromeManager === "undefined") return;

        const s = window.MonochromeManager.getSettings();
        const shouldEnable = category === "bw";
        if (!!s.monoMixerEnabled === shouldEnable) return;

        window.MonochromeManager.beginAction();
        window.MonochromeManager.updateSettings({ monoMixerEnabled: shouldEnable });

        // Le module désactivé masque la section Gomme locale : coupe aussi le
        // pinceau s'il était actif, comme le fait la case à cocher "Activer le
        // module Monochrome" dans monochromePanel.js.
        if (!shouldEnable && window.monochromeMaskController) {
            window.monochromeMaskController.cancelMode();
        }

        // loadHaldClutFile() a déjà rendu l'image avec l'ancien état Monochrome
        // (avant ce changement) : re-rendu pour que le résultat reflète bien le
        // nouvel état monoMixerEnabled.
        if (window.imageProcessor) window.imageProcessor.render();

        if (typeof window.renderMonochromePanel === "function") window.renderMonochromePanel();
    }

    function baseName(filePath) {
        if (!filePath) return "";
        return filePath.toString().replace(/\\/g, "/").split("/").pop();
    }

    function renderFilmPanel(pcArg) {
        const container = document.getElementById("filmPanelStatus");
        if (!container) return;

        _ensurePresetsLoaded();

        const fs = pcArg || (window.imageProcessor && window.imageProcessor.getFilmSettings && window.imageProcessor.getFilmSettings()) || {};
        const haldState = window.imageProcessor && window.imageProcessor.haldClutState;
        const haldPath = (haldState && haldState.path) || fs.haldClutPath || "";
        const haldFileName = baseName(haldPath);
        const haldLoaded = !!haldState;

        const presets = presetsCache || { bw: [], color: [] };
        const allPresets = [...presets.bw, ...presets.color];
        const matchingPreset = haldPath
            ? allPresets.find(p => normalizePath(p.path) === normalizePath(haldPath))
            : null;

        const presetSelectHtml = `
            <select data-film-field="haldPreset" style="width:100%; background:#171717; border:1px solid #444; color:#fff; padding:6px; border-radius:4px; font-size:12px; margin-bottom:8px;">
                <option value="">Aucun / Personnalisé</option>
                ${buildPresetOptions(presets.bw, "N&B")}
                ${buildPresetOptions(presets.color, "Couleur")}
            </select>
        `;

        container.innerHTML = `
        <h3>Simulation Pellicule</h3>
        <p style="font-size:11px; color:#949ba4; margin-bottom:8px;">
            Grain, halation et réponse colorimétrique — appliqués en toute fin de traitement.
        </p>

        <div class="film-section" style="margin-bottom:14px;">
            <h4 style="font-size:12px; color:#dbdee1; margin:0 0 6px;">Hald-CLUT (réponse pellicule)</h4>
            <label style="font-size:11px; color:#aaa; display:block; margin-bottom:4px;">Préréglage pellicule :</label>
            ${presetSelectHtml}
            <div class="mask-toolbar" style="margin-bottom:6px;">
                <button data-film-action="load-clut">${window.lucideIconHtml("upload", { size: 14 })} Charger un Hald-CLUT...</button>
                ${haldFileName ? `<button data-film-action="clear-clut" title="Retirer le LUT">${window.lucideIconHtml("x", { size: 14 })}</button>` : ""}
            </div>
            ${haldFileName ? `
            <p style="font-size:11px; color:${haldLoaded ? "#8ab4f8" : "#e08a8a"}; margin:0 0 8px; word-break:break-all;">
                ${haldLoaded ? "Fichier : " : "⚠ Fichier introuvable : "}${haldFileName}
            </p>
            ${fieldRow("Intensité du LUT", "haldClutIntensity", fs.haldClutIntensity ?? 100, 0, 100, 1)}
            ` : `
            <p style="font-size:11px; color:#666; font-style:italic; margin:0;">Aucun Hald-CLUT chargé.</p>
            `}
        </div>

        <div class="film-section" style="margin-bottom:14px; border-top:1px solid #333; padding-top:10px;">
            <h4 style="font-size:12px; color:#dbdee1; margin:0 0 6px;">Halation</h4>
            ${fieldRow("Intensité", "halationIntensity", fs.halationIntensity ?? 0, 0, 100, 1)}
            ${fieldRow("Seuil", "halationThreshold", fs.halationThreshold ?? 200, 100, 255, 1)}
            ${fieldRow("Rayon du flou", "halationRadius", fs.halationRadius ?? 8, 1, 40, 1)}
        </div>

        <div class="film-section" style="border-top:1px solid #333; padding-top:10px;">
            <h4 style="font-size:12px; color:#dbdee1; margin:0 0 6px;">Grain</h4>
            ${fieldRow("Intensité", "grainIntensity", fs.grainIntensity ?? 0, 0, 100, 1)}
            ${fieldRow("Taille du grain", "grainSize", fs.grainSize ?? 1, 1, 4, 0.25)}
        </div>
        `;

        // Sélectionne l'option correspondant au LUT actuellement chargé (via
        // .value plutôt que l'attribut HTML "selected", pour comparer la valeur
        // décodée réelle plutôt que la version échappée injectée dans le HTML).
        const presetSelect = container.querySelector('[data-film-field="haldPreset"]');
        if (presetSelect) presetSelect.value = matchingPreset ? matchingPreset.path : "";

        _bindFilmPanelEvents(container);
    }

    function _saveFilmState() {
        if (typeof window.saveCurrentPhotoSettingsToCatalog === "function") {
            window.saveCurrentPhotoSettingsToCatalog();
        }
    }

    function _bindFilmPanelEvents(container) {
        let renderTimer = null;
        let saveTimer = null;
        container.querySelectorAll(".pc-slider[data-field]").forEach(slider => {
            slider.addEventListener("input", () => {
                const value = Number(slider.value);
                const label = container.querySelector(`[data-value-for="${slider.dataset.field}"]`);
                if (label) label.textContent = value;

                if (window.imageProcessor) {
                    window.imageProcessor.notifySliderInput();
                    window.imageProcessor.updateFilmSetting(slider.dataset.field, value);

                    // Rendu du pipeline débouncé (lourd/synchrone) pour ne pas
                    // bloquer le curseur pendant le glissement — cf. masksPanel.js.
                    if (renderTimer) clearTimeout(renderTimer);
                    renderTimer = setTimeout(() => window.imageProcessor.render(), 30);
                }

                if (saveTimer) clearTimeout(saveTimer);
                saveTimer = setTimeout(_saveFilmState, 200);
            });

            // 🔹 Glissement en cours : previewBuffer même zoomé au-delà du seuil
            // pleine résolution — un pipeline complet (grain/halation/Hald-CLUT)
            // peut atteindre ~17s sur 24 Mpx (mesuré). Fin du geste : voir le
            // mouseup GLOBAL (app.js) -> ImageProcessor.endSliderDrag().
            slider.addEventListener("mousedown", () => {
                if (window.imageProcessor) window.imageProcessor.startSliderDrag();
            });
        });

        const presetSelect = container.querySelector('[data-film-field="haldPreset"]');
        if (presetSelect) {
            presetSelect.addEventListener("change", async () => {
                const filePath = presetSelect.value;
                // "Aucun / Personnalisé" : ne fait rien (ne retire pas un LUT déjà
                // chargé — utilise le bouton "Retirer" pour ça explicitement).
                if (!filePath || !window.imageProcessor) return;

                // La catégorie du préréglage est déjà connue via la liste dont il
                // provient (presets.bw / presets.color — même info que celle utilisée
                // pour regrouper les <optgroup> dans buildPresetOptions()).
                const presets = presetsCache || { bw: [], color: [] };
                const category = presets.bw.some(p => p.path === filePath) ? "bw"
                    : presets.color.some(p => p.path === filePath) ? "color"
                    : null;

                presetSelect.disabled = true;
                try {
                    await window.imageProcessor.loadHaldClutFile(filePath);
                    _syncMonochromeWithHaldCategory(category);
                    _saveFilmState();
                } catch (err) {
                    console.error("❌ Erreur chargement préréglage Hald-CLUT :", err);
                } finally {
                    renderFilmPanel();
                }
            });
        }

        const loadBtn = container.querySelector('[data-film-action="load-clut"]');
        if (loadBtn) {
            loadBtn.addEventListener("click", async () => {
                if (!window.electronAPI || typeof window.electronAPI.browseHaldClut !== "function" || !window.imageProcessor) return;

                const filePath = await window.electronAPI.browseHaldClut();
                if (!filePath) return;

                const category = _haldClutCategoryFromPath(filePath);

                loadBtn.disabled = true;
                try {
                    await window.imageProcessor.loadHaldClutFile(filePath);
                    _syncMonochromeWithHaldCategory(category);
                    _saveFilmState();
                } catch (err) {
                    console.error("❌ Erreur chargement Hald-CLUT :", err);
                } finally {
                    renderFilmPanel();
                }
            });
        }

        const clearBtn = container.querySelector('[data-film-action="clear-clut"]');
        if (clearBtn) {
            clearBtn.addEventListener("click", () => {
                if (!window.imageProcessor) return;
                window.imageProcessor.clearHaldClut();
                _saveFilmState();
                renderFilmPanel();
            });
        }
    }

    window.renderFilmPanel = renderFilmPanel;

})();
