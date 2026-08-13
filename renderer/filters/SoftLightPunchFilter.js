/*=========================================================
    Pixel RAW - Module Monochrome : Lumière tamisée + Courbe de contraste
    Reproduit en LUT le geste "Dupliquer le calque -> Lumière tamisée ->
    Fusionner" (auto-fusion soft-light), suivi d'une courbe de contraste
    en S (équivalent Renforcer le contraste / Contraste moyen).
=========================================================*/

class SoftLightPunchFilter {
    constructor() {
        this.softLightLut = this._buildSoftLightLut();
        this.contrastLut = this._buildContrastCurveLut();
    }

    // Formule Soft Light (W3C compositing) avec base = blend = même valeur x.
    _buildSoftLightLut() {
        const lut = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            const x = i / 255;
            let result;
            if (x <= 0.5) {
                result = x - (1 - 2 * x) * x * (1 - x);
            } else {
                const d = x <= 0.25 ? ((16 * x - 12) * x + 4) * x : Math.sqrt(x);
                result = x + (2 * x - 1) * (d - x);
            }
            lut[i] = result * 255;
        }
        return lut;
    }

    // Courbe en S standard (sigmoïde normalisée pour fixer les extrémités à
    // 0 et 255, sans écrêtage) — équivalent d'un préréglage "Contraste moyen".
    _buildContrastCurveLut() {
        const k = 7; // pente de la sigmoïde
        const sigmoid = (x) => 1 / (1 + Math.exp(-k * (x - 0.5)));
        const s0 = sigmoid(0);
        const s1 = sigmoid(1);

        const lut = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            const x = i / 255;
            const y = (sigmoid(x) - s0) / (s1 - s0);
            lut[i] = y * 255;
        }
        return lut;
    }

    _lutLookup(lut, value) {
        const idx = Math.max(0, Math.min(255, Math.round(value)));
        return lut[idx];
    }

    apply(imageData, settings) {
        if (!settings) return imageData;

        const softAmt = Math.max(0, Math.min(100, settings.softLightIntensity ?? 0)) / 100;
        const curveAmt = Math.max(0, Math.min(100, settings.contrastCurveIntensity ?? 0)) / 100;
        if (softAmt === 0 && curveAmt === 0) return imageData;

        const data = imageData.data;
        const len = data.length;

        // 🔹 Gomme locale (cible "punch") : 1 = effet plein, 0 = supprimé à ce
        // pixel — réduit ENSEMBLE la Lumière tamisée et la courbe de contraste
        // (une seule cible "Punch" pour les deux). Absente si rien n'est peint —
        // voir ImageProcessor._injectMonoLocalMultipliers.
        const localMultiplier = settings.punchLocalMultiplier;

        for (let i = 0, p = 0; i < len; i += 4, p++) {
            const localMult = localMultiplier ? localMultiplier[p] : 1;
            const effSoftAmt = softAmt * localMult;
            const effCurveAmt = curveAmt * localMult;
            if (effSoftAmt === 0 && effCurveAmt === 0) continue;

            for (let c = 0; c < 3; c++) {
                let v = data[i + c];

                if (effSoftAmt > 0) {
                    const soft = this._lutLookup(this.softLightLut, v);
                    v = v + (soft - v) * effSoftAmt;
                }

                if (effCurveAmt > 0) {
                    const curved = this._lutLookup(this.contrastLut, v);
                    v = v + (curved - v) * effCurveAmt;
                }

                data[i + c] = Math.max(0, Math.min(255, v));
            }
        }

        return imageData;
    }
}

if (typeof window !== "undefined") {
    window.SoftLightPunchFilter = SoftLightPunchFilter;
}
