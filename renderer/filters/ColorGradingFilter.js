class ColorGradingFilter {
    constructor() {
        this.name = "ColorGrading";
    }

    apply(imageData, pc) {
        if (!imageData || !pc) return imageData;

        // 1. Extraction souple de la valeur du slider (-5 à +5)
        const rawGrading = pc.colorGrading ?? pc.grading ?? 0;
        const gradingValue = typeof rawGrading === "number" ? rawGrading : parseFloat(rawGrading) || 0;

        // Si le curseur est à 0, pas de calcul (gain de performance)
        if (gradingValue === 0) return imageData;

        const data = imageData.data;
        const len = data.length;

        // 2. Calcul du virage colorimétrique (Grading)
        // Les valeurs négatives réchauffent les ombres/tons (Style Vintage / Warm)
        // Les valeurs positives refroidissent / teintent en bleu-cyan (Style Teal & Orange / Cool)
        const shiftR = gradingValue * 4;
        const shiftB = -gradingValue * 4;

        for (let i = 0; i < len; i += 4) {
            const r = data[i];
            const b = data[i + 2];

            // Calcul de la luminance pour appliquer l'étalonnage selon la tonalité
            const luminance = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;

            // Application progressive selon la luminance
            const factor = Math.sin(luminance * Math.PI); // Accentuation sur les tons moyens

            data[i]     = Math.min(255, Math.max(0, r + shiftR * factor));
            data[i + 2] = Math.min(255, Math.max(0, b + shiftB * factor));
        }

        return imageData;
    }
}

window.ColorGradingFilter = ColorGradingFilter;