/*=========================================================
    Pixel RAW - Panneau Préréglages complets (Studio)
    Picture Control + module Monochrome + Simulation Pellicule capturés en
    une seule "recette" nommée, applicable en un clic sur n'importe quelle
    photo. Distinct des Hald-CLUT (réponse colorimétrique seule, voir
    filmPanel.js) et des profils NP3/NPC Nikon (spécifiques au format
    caméra). Studio uniquement : n'agit que sur window.imageProcessor,
    jamais sur profileImageProcessor (Gestionnaire de Profils).
=========================================================*/

(function () {

    // 🔹 Préréglages (intégrés assets/presets/ + personnalisés userData/
    // presets-custom/) : lus une seule fois via IPC et mis en cache, comme le
    // fait filmPanel.js pour les préréglages Hald-CLUT. Invalidé (mis à null)
    // après chaque enregistrement/suppression pour forcer un rechargement.
    let presetsCache = null;
    let presetsLoading = false;

    function _ensurePresetsLoaded() {
        if (presetsCache || presetsLoading) return;
        if (!window.electronAPI || typeof window.electronAPI.listPresets !== "function") return;

        presetsLoading = true;
        window.electronAPI.listPresets()
            .then(result => {
                presetsCache = result && typeof result === "object" ? result : { builtin: [], custom: [] };
            })
            .catch(err => {
                console.error("❌ Erreur chargement des préréglages :", err);
                presetsCache = { builtin: [], custom: [] };
            })
            .finally(() => {
                presetsLoading = false;
                renderPresetsPanel();
            });
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function _entryHtml(preset, isCustom) {
        return `
            <div class="preset-entry" data-preset-action="apply" data-preset-path="${escapeHtml(preset.path)}"
                 style="display:flex; align-items:center; justify-content:space-between; gap:6px; padding:5px 8px; border-radius:4px; cursor:pointer;">
                <span style="font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(preset.name)}">${escapeHtml(preset.name)}</span>
                ${isCustom ? `<button data-preset-action="delete" data-preset-path="${escapeHtml(preset.path)}" title="Supprimer ce préréglage" style="flex-shrink:0;">${window.lucideIconHtml("trash-2", { size: 12 })}</button>` : ""}
            </div>`;
    }

    function _subGroupHtml(label, list, isCustom) {
        if (!list.length) return "";
        return `
            <div style="font-size:10px; color:#777; text-transform:uppercase; letter-spacing:0.03em; margin:6px 0 2px;">${label}</div>
            ${list.map(p => _entryHtml(p, isCustom)).join("")}`;
    }

    function _groupHtml(list, groupLabel, isCustom) {
        const bw = list.filter(p => p.category !== "color");
        const color = list.filter(p => p.category === "color");

        let html = `<div style="font-size:11px; color:#949ba4; text-transform:uppercase; letter-spacing:0.03em; margin:10px 0 2px;">${groupLabel}</div>`;
        if (!list.length) {
            html += `<p style="font-size:11px; color:#666; font-style:italic; margin:2px 0 4px;">Aucun préréglage${isCustom ? " personnalisé" : ""}.</p>`;
            return html;
        }
        html += _subGroupHtml("N&B", bw, isCustom);
        html += _subGroupHtml("Couleur", color, isCustom);
        return html;
    }

    function renderPresetsPanel() {
        const container = document.getElementById("presetsPanelStatus");
        if (!container) return;

        _ensurePresetsLoaded();

        const presets = presetsCache || { builtin: [], custom: [] };
        const hasPhoto = !!(window.imageProcessor && window.imageProcessor.originalRawBuffer);

        container.innerHTML = `
        <h3 style="font-size: 13px; color: #ccc; margin-bottom: 10px;">Préréglages</h3>
        <p style="font-size:11px; color:#949ba4; margin-bottom:4px;">
            Picture Control + Monochrome + Simulation Pellicule, en un clic.
        </p>
        <div id="presetsList" style="${hasPhoto ? "" : "opacity:0.5; pointer-events:none;"}">
            ${_groupHtml(presets.builtin, "Préréglages intégrés", false)}
            ${_groupHtml(presets.custom, "Mes préréglages", true)}
        </div>
        <button data-preset-action="save-current" ${hasPhoto ? "" : "disabled"} class="btn-secondary" style="width:100%; margin-top:10px; font-size:11px;">
            ${window.lucideIconHtml("save", { size: 14 })} Enregistrer le préréglage actuel...
        </button>
        `;

        _bindPresetsPanelEvents(container);
    }

    function _bindPresetsPanelEvents(container) {
        container.querySelectorAll('[data-preset-action="apply"]').forEach(el => {
            el.addEventListener("click", () => _applyPresetFromPath(el.dataset.presetPath));
        });

        container.querySelectorAll('[data-preset-action="delete"]').forEach(btn => {
            btn.addEventListener("click", (e) => {
                // Ne pas déclencher l'application du préréglage (clic sur l'entrée
                // parente) en cliquant sur son bouton de suppression.
                e.stopPropagation();
                _deletePreset(btn.dataset.presetPath);
            });
        });

        const saveBtn = container.querySelector('[data-preset-action="save-current"]');
        if (saveBtn) saveBtn.addEventListener("click", () => _openSavePresetModal());
    }

    /**
     * Applique un préréglage à la photo actuellement affichée dans le Studio :
     * charge son JSON, délègue à ImageProcessor.applyPreset() (Picture Control +
     * Monochrome + Simulation Pellicule, un seul rendu final), puis rafraîchit
     * les panneaux dépendants pour que leurs curseurs reflètent le nouvel état,
     * et sauvegarde le résultat pour cette photo comme n'importe quel autre
     * changement de réglage.
     */
    async function _applyPresetFromPath(presetPath) {
        if (!presetPath || !window.imageProcessor || !window.electronAPI) return;
        if (!window.imageProcessor.originalRawBuffer) return;

        try {
            const presetData = await window.electronAPI.loadPreset(presetPath);
            if (!presetData) {
                alert("Impossible de charger ce préréglage.");
                return;
            }

            await window.imageProcessor.applyPreset(presetData);

            if (typeof window.updatePictureControl === "function") {
                window.updatePictureControl({ pictureControl: window.imageProcessor.pictureControl }, false);
            }
            if (typeof window.renderMonochromePanel === "function") window.renderMonochromePanel();
            if (typeof window.renderFilmPanel === "function") window.renderFilmPanel();

            if (typeof window.saveCurrentPhotoSettingsToCatalog === "function") {
                window.saveCurrentPhotoSettingsToCatalog();
            }
        } catch (err) {
            console.error("❌ Erreur application du préréglage :", err);
            alert("Erreur lors de l'application du préréglage.");
        }
    }

    function _deletePreset(presetPath) {
        if (!presetPath || !window.electronAPI) return;

        const known = (presetsCache && presetsCache.custom) || [];
        const preset = known.find(p => p.path === presetPath);
        const label = preset ? preset.name : "ce préréglage";

        const confirmed = confirm(`Supprimer le préréglage "${label}" ? Cette action est irréversible.`);
        if (!confirmed) return;

        window.electronAPI.deletePreset(presetPath)
            .then(result => {
                if (!result || !result.success) {
                    alert("Impossible de supprimer ce préréglage.");
                    return;
                }
                presetsCache = null;
                renderPresetsPanel();
            })
            .catch(err => {
                console.error("❌ Erreur suppression du préréglage :", err);
                alert("Erreur lors de la suppression du préréglage.");
            });
    }

    /**
     * Capture l'état ACTUEL de pictureControl/MonochromeManager/filmSettings
     * sur la photo affichée — même format que ce qu'applyPreset() consomme,
     * pour que "Enregistrer" et "Appliquer" restent l'inverse exact l'un de
     * l'autre. monoEraseMasks (Gomme locale, propre à CETTE photo) est
     * explicitement exclu — voir le format documenté en tête de fichier.
     */
    function _captureCurrentPreset(name, category) {
        const pc = (window.imageProcessor && window.imageProcessor.pictureControl) || {};

        const monoSettings = (window.MonochromeManager && window.MonochromeManager.getSettings()) || {};
        const { monoEraseMasks, ...monochromeForPreset } = monoSettings;

        const film = (window.imageProcessor && window.imageProcessor.getFilmSettings && window.imageProcessor.getFilmSettings()) || {};

        return {
            name,
            category: category === "color" ? "color" : "bw",
            pictureControl: { ...pc },
            monochrome: { ...monochromeForPreset },
            film: { ...film }
        };
    }

    /**
     * Modale "Enregistrer le préréglage actuel..." — même style/pattern que la
     * modale Ratio d'aspect personnalisé (index.html #cropCustomRatioModal,
     * voir cropPanel.js). Éléments DOM statiques présents dès le chargement de
     * la page : bindings faits une seule fois ici via `onclick` (idempotent).
     */
    function _initSavePresetModal() {
        const modal = document.getElementById("savePresetModal");
        const inputName = document.getElementById("savePresetName");
        const selectCategory = document.getElementById("savePresetCategory");
        const errorEl = document.getElementById("savePresetError");
        const btnClose = document.getElementById("btnCloseSavePresetModal");
        const btnCancel = document.getElementById("btnCancelSavePreset");
        const btnConfirm = document.getElementById("btnConfirmSavePreset");
        if (!modal || !inputName || !selectCategory || !btnConfirm) return;

        const close = () => { modal.style.display = "none"; };
        if (btnClose) btnClose.onclick = close;
        if (btnCancel) btnCancel.onclick = close;

        btnConfirm.onclick = async () => {
            const name = inputName.value.trim();
            if (!name) {
                if (errorEl) {
                    errorEl.textContent = "Saisissez un nom pour ce préréglage.";
                    errorEl.style.display = "block";
                }
                return;
            }
            if (!window.imageProcessor || !window.electronAPI) return;

            const presetData = _captureCurrentPreset(name, selectCategory.value);

            btnConfirm.disabled = true;
            try {
                const result = await window.electronAPI.savePreset(presetData);
                if (!result || !result.success) {
                    if (errorEl) {
                        errorEl.textContent = (result && result.error) || "Erreur lors de l'enregistrement.";
                        errorEl.style.display = "block";
                    }
                    return;
                }
                close();
                presetsCache = null;
                renderPresetsPanel();
            } catch (err) {
                console.error("❌ Erreur enregistrement du préréglage :", err);
                if (errorEl) {
                    errorEl.textContent = "Erreur lors de l'enregistrement.";
                    errorEl.style.display = "block";
                }
            } finally {
                btnConfirm.disabled = false;
            }
        };
    }

    function _openSavePresetModal() {
        const modal = document.getElementById("savePresetModal");
        const inputName = document.getElementById("savePresetName");
        const selectCategory = document.getElementById("savePresetCategory");
        const errorEl = document.getElementById("savePresetError");
        if (!modal || !inputName || !selectCategory) return;

        inputName.value = "";
        // Pré-sélectionne la catégorie la plus probable d'après l'état actuel
        // du module Monochrome — simple suggestion, modifiable avant d'enregistrer.
        const monoEnabled = !!(window.MonochromeManager && window.MonochromeManager.getSettings().monoMixerEnabled);
        selectCategory.value = monoEnabled ? "bw" : "color";
        if (errorEl) errorEl.style.display = "none";

        modal.style.display = "flex";
        inputName.focus();
    }

    _initSavePresetModal();

    window.renderPresetsPanel = renderPresetsPanel;

})();
