class BlackWhitePointFilter {
    constructor() {
        this.name = "BlackWhitePoint";
    }

    apply(imageData, pc) {
        if (!imageData || !pc) return imageData;

        let blackPoint = pc.blackPoint ?? 0;
        blackPoint = typeof blackPoint === "number" ? blackPoint : parseFloat(blackPoint) || 0;

        let whitePoint = pc.whitePoint ?? 255;
        whitePoint = typeof whitePoint === "number" ? whitePoint : (parseFloat(whitePoint) || 255);

        // Sécurité : point noir < point blanc, plages valides 0-255
        blackPoint = Math.min(254, Math.max(0, blackPoint));
        whitePoint = Math.min(255, Math.max(blackPoint + 1, whitePoint));

        // Neutre : rien à faire
        if (blackPoint === 0 && whitePoint === 255) return imageData;

        const range = whitePoint - blackPoint;
        const data = imageData.data;
        const len = data.length;

        for (let i = 0; i < len; i += 4) {
            data[i]     = Math.min(255, Math.max(0, ((data[i]     - blackPoint) / range) * 255));
            data[i + 1] = Math.min(255, Math.max(0, ((data[i + 1] - blackPoint) / range) * 255));
            data[i + 2] = Math.min(255, Math.max(0, ((data[i + 2] - blackPoint) / range) * 255));
        }

        return imageData;
    }
}

window.BlackWhitePointFilter = BlackWhitePointFilter;
