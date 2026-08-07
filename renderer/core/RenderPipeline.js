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
        if (!imageData || !imageData.data) return imageData;
        
        let currentData = imageData;

        for (const filter of this.filters) {
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