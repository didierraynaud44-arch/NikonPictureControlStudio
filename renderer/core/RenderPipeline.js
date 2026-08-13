/*=========================================================
    Nikon Picture Control Studio - Render Pipeline
=========================================================*/

class RenderPipeline {
    constructor() {
        this.filters = [];
    }

    add(filter) {
        if (filter) {
            this.filters.push(filter);
        }
    }

    process(imageData, settings) {
        return this.processRange(imageData, settings, 0, this.filters.length);
    }

    /**
     * Exécute seulement les filtres [startIndex, endIndex) — utilisé par
     * ImageProcessor pour insérer la Gomme du module Monochrome juste après
     * le trio Mixeur N&B/Lumière tamisée/Dodge & Burn, sans dupliquer la
     * logique d'itération/gestion d'erreurs de process().
     */
    processRange(imageData, settings, startIndex, endIndex) {
        if (!imageData || !imageData.data) return imageData;

        let currentData = imageData;
        const end = Math.min(endIndex, this.filters.length);

        for (let i = Math.max(0, startIndex); i < end; i++) {
            const filter = this.filters[i];
            if (!filter) continue;

            try {
                if (typeof filter.process === "function") {
                    currentData = filter.process(currentData, settings);
                } else if (typeof filter.apply === "function") {
                    currentData = filter.apply(currentData, settings);
                }
            } catch (err) {
                console.error(`❌ Erreur dans le filtre ${filter.constructor?.name || 'inconnu'} :`, err);
            }
        }

        return currentData;
    }
}

if (typeof window !== "undefined") {
    window.RenderPipeline = RenderPipeline;
}