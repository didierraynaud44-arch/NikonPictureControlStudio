/*=========================================================
    Pixel RAW - Panneau Débruitage neuronal (NAFNet, Studio)
    Même convention que retouchPanel.js : un conteneur dédié
    (#neuralDenoisePanelStatus), entièrement régénéré à chaque appel de
    renderNeuralDenoisePanel(), écouteurs re-liés à chaque fois.
=========================================================*/

let _neuralDenoiseProcessing = false;
let _neuralDenoiseProgress = { done: 0, total: 0 };
let _neuralDenoiseCancelSignal = null;

function _saveNeuralDenoiseState() {
    if (typeof window.saveCurrentPhotoSettingsToCatalog === "function") {
        window.saveCurrentPhotoSettingsToCatalog();
    }
}

async function _startNeuralDenoise() {
    const ip = window.imageProcessor;
    if (!ip || _neuralDenoiseProcessing) return;

    _neuralDenoiseProcessing = true;
    _neuralDenoiseProgress = { done: 0, total: 0 };
    _neuralDenoiseCancelSignal = { cancelled: false };
    renderNeuralDenoisePanel();

    const onProgress = (done, total) => {
        _neuralDenoiseProgress = { done, total };
        renderNeuralDenoisePanel();
    };

    const success = await ip.applyNeuralDenoise(onProgress, _neuralDenoiseCancelSignal);

    _neuralDenoiseProcessing = false;
    _neuralDenoiseCancelSignal = null;
    renderNeuralDenoisePanel();

    if (success) _saveNeuralDenoiseState();
}

function _cancelNeuralDenoise() {
    if (_neuralDenoiseCancelSignal) _neuralDenoiseCancelSignal.cancelled = true;
}

function renderNeuralDenoisePanel() {
    const container = document.getElementById("neuralDenoisePanelStatus");
    const ip = window.imageProcessor;
    if (!container || !ip) return;

    const header = `<h3>Débruitage neuronal (expérimental)</h3>`;
    let body;

    if (_neuralDenoiseProcessing) {
        const { done, total } = _neuralDenoiseProgress;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        body = `
        <p style="font-size:11px; color:#ffd166; margin-bottom:8px;">
            ${window.lucideIconHtml("loader-circle", { size: 13 })} Traitement en cours — tuile ${done} / ${total || "?"} (${pct}%)
        </p>
        <div style="background:#1e1f22; border-radius:4px; height:8px; overflow:hidden; margin-bottom:10px;">
            <div style="background:#5865f2; height:100%; width:${pct}%;"></div>
        </div>
        <div class="mask-toolbar">
            <button data-neuraldenoise-action="cancel">${window.lucideIconHtml("x", { size: 14 })} Annuler</button>
        </div>`;
    } else if (ip.neuralDenoiseApplied) {
        body = `
        <p style="font-size:12px; color:#8fce9e; margin-bottom:8px;">
            ${window.lucideIconHtml("check", { size: 13 })} Débruitage neuronal appliqué
        </p>
        <div class="mask-toolbar">
            <button data-neuraldenoise-action="remove">${window.lucideIconHtml("undo-2", { size: 14 })} Retirer</button>
        </div>`;
    } else if (ip.neuralDenoisePending) {
        body = `
        <p style="font-size:11px; color:#949ba4; margin-bottom:8px;">
            Débruitage neuronal précédemment appliqué à cette photo — non recalculé automatiquement.
        </p>
        <div class="mask-toolbar">
            <button data-neuraldenoise-action="reapply">Réappliquer</button>
        </div>`;
    } else {
        body = `
        <p style="font-size:11px; color:#949ba4; margin-bottom:8px;">
            Réseau de neurones NAFNet (MIT), appliqué UNE FOIS à la demande — comme le
            Tampon de duplication, indépendant du curseur "Réduction du bruit" ci-dessus.
        </p>
        <p style="font-size:11px; color:#ffd166; margin-bottom:8px;">
            ⚠️ Peut prendre plusieurs dizaines de secondes selon la résolution.
        </p>
        <div class="mask-toolbar">
            <button data-neuraldenoise-action="apply">Appliquer</button>
        </div>`;
    }

    container.innerHTML = header + body;
    _bindNeuralDenoisePanelEvents(container);
}

function _bindNeuralDenoisePanelEvents(container) {
    container.querySelectorAll('[data-neuraldenoise-action="apply"], [data-neuraldenoise-action="reapply"]').forEach(btn => {
        btn.addEventListener("click", () => _startNeuralDenoise());
    });

    container.querySelectorAll('[data-neuraldenoise-action="cancel"]').forEach(btn => {
        btn.addEventListener("click", () => _cancelNeuralDenoise());
    });

    container.querySelectorAll('[data-neuraldenoise-action="remove"]').forEach(btn => {
        btn.addEventListener("click", () => {
            if (window.imageProcessor) window.imageProcessor.removeNeuralDenoise();
            renderNeuralDenoisePanel();
            _saveNeuralDenoiseState();
        });
    });
}

window.renderNeuralDenoisePanel = renderNeuralDenoisePanel;
