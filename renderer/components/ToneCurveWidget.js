/*=========================================================
    Nikon Picture Control Studio - Tone Curve Widget
=========================================================*/

class ToneCurveWidget {
    constructor(containerId, onChangeCallback) {
        this.container = document.getElementById(containerId);
        this.onChange = onChangeCallback;

        // Points par défaut (diagonale linéaire neutre)
        this.points = [
            { x: 0, y: 0 },
            { x: 255, y: 255 }
        ];

        this.selectedPointIndex = null;
        this.isDragging = false;
        this.size = 200; // Dimension carrée du canvas

        this.initDOM();
        this.initEvents();
        this.update();
    }

    initDOM() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="tone-curve-widget" style="background:#1e1e1e; padding:10px; border-radius:6px; border:1px solid #444; width:${this.size}px; margin: 10px 0;">
                <canvas id="curveCanvas" width="${this.size}" height="${this.size}" style="background:#111; border:1px solid #333; cursor:crosshair; border-radius:4px; display:block;"></canvas>
                <div style="display:flex; justify-content:space-between; margin-top:6px;">
                    <span style="font-size:11px; color:#888;">Ombres</span>
                    <button id="resetCurveBtn" style="background:#333; color:#ccc; border:none; padding:2px 8px; font-size:10px; border-radius:3px; cursor:pointer;">RAZ Courbe</button>
                    <span style="font-size:11px; color:#888;">Lumières</span>
                </div>
            </div>
        `;

        this.canvas = document.getElementById("curveCanvas");
        this.ctx = this.canvas.getContext("2d");
    }

    initEvents() {
        if (!this.canvas) return;

        // Clic / Déplacement
        this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
        window.addEventListener("mousemove", (e) => this.onMouseMove(e));
        window.addEventListener("mouseup", () => this.onMouseUp());

        // Double-clic pour supprimer un point
        this.canvas.addEventListener("dblclick", (e) => this.onDblClick(e));

        // Bouton réinitialiser
        const resetBtn = document.getElementById("resetCurveBtn");
        if (resetBtn) {
            resetBtn.addEventListener("click", () => this.reset());
        }
    }

    reset() {
        this.points = [
            { x: 0, y: 0 },
            { x: 255, y: 255 }
        ];
        this.selectedPointIndex = null;
        this.update();
    }

    getCanvasCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = Math.max(0, Math.min(this.size, e.clientX - rect.left));
        const mouseY = Math.max(0, Math.min(this.size, e.clientY - rect.top));

        // Inversion Y (0 en bas pour la courbe, 255 en haut)
        return {
            x: (mouseX / this.size) * 255,
            y: (1 - mouseY / this.size) * 255
        };
    }

    onMouseDown(e) {
        const coords = this.getCanvasCoords(e);
        const radius = 12; // Rayon de détection des points

        // Recherche d'un point existant proche
        let foundIdx = -1;
        this.points.forEach((pt, idx) => {
            const px = (pt.x / 255) * this.size;
            const py = (1 - pt.y / 255) * this.size;
            const mx = (coords.x / 255) * this.size;
            const my = (1 - coords.y / 255) * this.size;

            if (Math.hypot(px - mx, py - my) < radius) {
                foundIdx = idx;
            }
        });

        if (foundIdx !== -1) {
            this.selectedPointIndex = foundIdx;
        } else {
            // Création d'un nouveau point
            this.points.push(coords);
            this.points.sort((a, b) => a.x - b.x);
            this.selectedPointIndex = this.points.findIndex(p => p.x === coords.x && p.y === coords.y);
        }

        this.isDragging = true;
        this.update();
    }

    onMouseMove(e) {
        if (!this.isDragging || this.selectedPointIndex === null) return;

        const coords = this.getCanvasCoords(e);
        const pt = this.points[this.selectedPointIndex];

        // Verrouillage des extrémités x=0 et x=255
        if (this.selectedPointIndex === 0) {
            pt.y = coords.y;
        } else if (this.selectedPointIndex === this.points.length - 1) {
            pt.y = coords.y;
        } else {
            pt.x = coords.x;
            pt.y = coords.y;
            this.points.sort((a, b) => a.x - b.x);
            this.selectedPointIndex = this.points.indexOf(pt);
        }

        this.update();
    }

    onMouseUp() {
        if (this.isDragging) {
            this.isDragging = false;
        }
    }

    onDblClick(e) {
        const coords = this.getCanvasCoords(e);
        const radius = 12;

        // Ne pas supprimer le premier ni le dernier point
        for (let i = 1; i < this.points.length - 1; i++) {
            const pt = this.points[i];
            const px = (pt.x / 255) * this.size;
            const py = (1 - pt.y / 255) * this.size;
            const mx = (coords.x / 255) * this.size;
            const my = (1 - coords.y / 255) * this.size;

            if (Math.hypot(px - mx, py - my) < radius) {
                this.points.splice(i, 1);
                this.selectedPointIndex = null;
                this.update();
                break;
            }
        }
    }

    /**
     * Calcule la LUT de 256 valeurs par interpolation Spline
     */
    getLUT() {
        const lut = new Uint8Array(256);
        
        for (let x = 0; x < 256; x++) {
            // Recherche des points encadrants
            let i = 0;
            while (i < this.points.length - 1 && this.points[i + 1].x < x) {
                i++;
            }

            if (i >= this.points.length - 1) {
                lut[x] = Math.round(this.points[this.points.length - 1].y);
                continue;
            }

            const p0 = this.points[Math.max(0, i - 1)];
            const p1 = this.points[i];
            const p2 = this.points[i + 1];
            const p3 = this.points[Math.min(this.points.length - 1, i + 2)];

            const t = (x - p1.x) / (p2.x - p1.x || 1);

            // Spline de Catmull-Rom
            const t2 = t * t;
            const t3 = t2 * t;

            const y = 0.5 * (
                (2 * p1.y) +
                (-p0.y + p2.y) * t +
                (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
            );

            lut[x] = Math.min(255, Math.max(0, Math.round(y)));
        }

        return lut;
    }

    draw() {
        if (!this.ctx) return;

        const w = this.size;
        const h = this.size;
        this.ctx.clearRect(0, 0, w, h);

        // 1. Grille de fond (4x4)
        this.ctx.strokeStyle = "#282828";
        this.ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo((w / 4) * i, 0);
            this.ctx.lineTo((w / 4) * i, h);
            this.ctx.stroke();

            this.ctx.beginPath();
            this.ctx.moveTo(0, (h / 4) * i);
            this.ctx.lineTo(w, (h / 4) * i);
            this.ctx.stroke();
        }

        // 2. Diagonale de référence
        this.ctx.strokeStyle = "#3a3a3a";
        this.ctx.setLineDash([4, 4]);
        this.ctx.beginPath();
        this.ctx.moveTo(0, h);
        this.ctx.lineTo(w, 0);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        // 3. Dessin de la Courbe
        const lut = this.getLUT();
        this.ctx.strokeStyle = "#00aaff";
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();

        for (let x = 0; x < 256; x++) {
            const px = (x / 255) * w;
            const py = (1 - lut[x] / 255) * h;
            if (x === 0) this.ctx.moveTo(px, py);
            else this.ctx.lineTo(px, py);
        }
        this.ctx.stroke();

        // 4. Dessin des points d'ancrage
        this.points.forEach((pt, idx) => {
            const px = (pt.x / 255) * w;
            const py = (1 - pt.y / 255) * h;

            this.ctx.beginPath();
            this.ctx.arc(px, py, 5, 0, Math.PI * 2);
            this.ctx.fillStyle = idx === this.selectedPointIndex ? "#fff" : "#00aaff";
            this.ctx.fill();
            this.ctx.strokeStyle = "#111";
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();
        });
    }

    update() {
        this.draw();
        if (typeof this.onChange === "function") {
            this.onChange(this.getLUT());
        }
    }
}

if (typeof window !== "undefined") {
    window.ToneCurveWidget = ToneCurveWidget;
}