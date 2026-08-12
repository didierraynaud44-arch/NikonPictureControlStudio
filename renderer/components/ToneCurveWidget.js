/*=========================================================
    Nikon Picture Control Studio - Tone Curve Widget
=========================================================*/

class ToneCurveWidget {
    constructor(containerId, onChangeCallback) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.onChange = onChangeCallback;

        this.activeChannel = "rgb"; // "rgb", "red", "green", "blue"
        this.curveType = "spline";  // "spline" ou "linear"
        this.isPickerActive = false;

        this.channels = {
            rgb:   [{ x: 0, y: 0 }, { x: 255, y: 255 }],
            red:   [{ x: 0, y: 0 }, { x: 255, y: 255 }],
            green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
            blue:  [{ x: 0, y: 0 }, { x: 255, y: 255 }]
        };

        this.selectedPointIndex = null;
        this.isDragging = false;
        this.size = 200;

        if (!this.container) {
            window.addEventListener("DOMContentLoaded", () => {
                this.container = document.getElementById(containerId);
                this.init();
            });
        } else {
            this.init();
        }
    }

    init() {
        if (!this.container) return;
        this.initDOM();
        this.initEvents();
        this.update();
    }

    get points() {
        return this.channels[this.activeChannel];
    }

    set points(val) {
        this.channels[this.activeChannel] = val;
    }

    initDOM() {
        if (!this.container) return;

        this.container.style.display = "block";
        
        // Sécurité : Si le widget est déjà injecté dans le container, on ne le détruit pas
        if (!this.container.querySelector("#curveCanvas")) {
            this.container.innerHTML = `
                <div class="tone-curve-widget" style="background:#1e1e1e; padding:10px; border-radius:6px; border:1px solid #444; width:${this.size}px; margin: 10px auto; box-sizing: content-box;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span style="font-size:11px; color:#aaa;">Canal :</span>
                        <select id="curveChannelSelect" style="background:#2a2a2a; color:#fff; border:1px solid #555; padding:2px 4px; font-size:11px; border-radius:3px; outline:none; cursor:pointer;">
                            <option value="rgb">RVB (Global)</option>
                            <option value="red">Rouge</option>
                            <option value="green">Vert</option>
                            <option value="blue">Bleu</option>
                        </select>
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:4px;">
                        <select id="curveTypeSelect" style="background:#2a2a2a; color:#fff; border:1px solid #555; padding:2px 4px; font-size:10px; border-radius:3px; outline:none; cursor:pointer; flex:1;">
                            <option value="spline">Courbe</option>
                            <option value="linear">Linéaire</option>
                        </select>
                        <select id="curvePresetSelect" style="background:#2a2a2a; color:#fff; border:1px solid #555; padding:2px 4px; font-size:10px; border-radius:3px; outline:none; cursor:pointer; flex:1.2;">
                            <option value="">Presets...</option>
                            <option value="reset">Neutre (RAZ)</option>
                            <option value="medium">Contraste moyen</option>
                            <option value="high">Contraste fort</option>
                        </select>
                    </div>

                    <button id="btnPickerPoint" style="width:100%; background:#2d3748; color:#319795; border:1px solid #319795; padding:4px 0; font-size:10px; border-radius:3px; cursor:pointer; margin-bottom:8px; font-weight:bold; transition:all 0.2s;">
                        ${window.lucideIconHtml("pipette", { size: 12 })} Pipette : Point depuis photo
                    </button>

                    <canvas id="curveCanvas" width="${this.size}" height="${this.size}" style="background:#111; border:1px solid #333; cursor:crosshair; border-radius:4px; display:block; margin:0 auto;"></canvas>
                    
                    <div style="display:flex; justify-content:space-between; margin-top:6px; align-items:center;">
                        <span style="font-size:10px; color:#777;">Ombres</span>
                        <button id="resetCurveBtn" style="background:#333; color:#ccc; border:none; padding:2px 8px; font-size:10px; border-radius:3px; cursor:pointer;">RAZ Canal</button>
                        <span style="font-size:10px; color:#777;">Lumières</span>
                    </div>
                </div>
            `;
        }

        this.canvas = this.container.querySelector("#curveCanvas");
        if (this.canvas) {
            this.ctx = this.canvas.getContext("2d");
        }
    }

    initEvents() {
        if (!this.canvas) return;

        if (this._eventsInitialized) return;
        this._eventsInitialized = true;

        // 🎯 INTERCEPTION DU ZOOM GLOBAL SURVOL WIDGET
        const blockGlobalZoom = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };

        // Survol du widget : neutralise la molette de zoom d'image
        this.container.addEventListener("mouseenter", () => {
            window.addEventListener("wheel", blockGlobalZoom, { capture: true, passive: false });
        });

        // Curseur sortant : restitue le zoom d'image
        this.container.addEventListener("mouseleave", () => {
            window.removeEventListener("wheel", blockGlobalZoom, { capture: true });
        });

        // Interaction Molette interne sur la Courbe
        this.canvas.addEventListener("wheel", (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.selectedPointIndex !== null && this.selectedPointIndex > 0 && this.selectedPointIndex < this.points.length - 1) {
                const delta = e.deltaY < 0 ? 3 : -3;
                const pt = this.points[this.selectedPointIndex];
                pt.y = Math.min(255, Math.max(0, pt.y + delta));
                this.update();
            }
        }, { passive: false });

        // Événements Souris Canvas Courbe
        this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
        window.addEventListener("mousemove", (e) => this.onMouseMove(e));
        window.addEventListener("mouseup", () => this.onMouseUp());
        this.canvas.addEventListener("dblclick", (e) => this.onDblClick(e));

        // Événements de sélection UI
        const channelSelect = this.container.querySelector("#curveChannelSelect");
        if (channelSelect) {
            channelSelect.addEventListener("change", (e) => {
                this.activeChannel = e.target.value;
                this.selectedPointIndex = null;
                this.update();
            });
        }

        const typeSelect = this.container.querySelector("#curveTypeSelect");
        if (typeSelect) {
            typeSelect.addEventListener("change", (e) => {
                this.curveType = e.target.value;
                this.update();
            });
        }

        const presetSelect = this.container.querySelector("#curvePresetSelect");
        if (presetSelect) {
            presetSelect.addEventListener("change", (e) => {
                this.applyPreset(e.target.value);
                e.target.value = "";
            });
        }

        const resetBtn = this.container.querySelector("#resetCurveBtn");
        if (resetBtn) {
            resetBtn.addEventListener("click", () => this.reset());
        }

        const pickerBtn = this.container.querySelector("#btnPickerPoint");
        if (pickerBtn) {
            pickerBtn.addEventListener("click", () => this.activateImagePicker());
        }
    }

    applyPreset(presetName) {
        if (presetName === "reset") {
            this.reset();
            return;
        }

        if (presetName === "medium") {
            this.points = [
                { x: 0, y: 0 },
                { x: 64, y: 48 },
                { x: 192, y: 208 },
                { x: 255, y: 255 }
            ];
        } else if (presetName === "high") {
            this.points = [
                { x: 0, y: 0 },
                { x: 64, y: 32 },
                { x: 192, y: 224 },
                { x: 255, y: 255 }
            ];
        }

        this.selectedPointIndex = null;
        this.update();
    }

    reset() {
        this.points = [
            { x: 0, y: 0 },
            { x: 255, y: 255 }
        ];
        this.selectedPointIndex = null;
        this.update();
    }

    activateImagePicker() {
        const targetCanvas = document.getElementById("mainCanvas") || document.getElementById("previewCanvas") || document.querySelector("canvas");
        const pickerBtn = this.container.querySelector("#btnPickerPoint");

        if (!targetCanvas) {
            console.warn("⚠️ Canvas photo introuvable.");
            return;
        }

        this.isPickerActive = true;
        const originalCursor = targetCanvas.style.cursor;
        targetCanvas.style.cursor = "crosshair";

        const blockNavigation = (e) => {
            if (this.isPickerActive) {
                e.stopImmediatePropagation();
                e.stopPropagation();
                e.preventDefault();
            }
        };

        window.addEventListener("wheel", blockNavigation, { capture: true });
        window.addEventListener("mousedown", blockNavigation, { capture: true });

        if (pickerBtn) {
            pickerBtn.style.background = "#e53e3e";
            pickerBtn.style.borderColor = "#fc8181";
            pickerBtn.style.color = "#fff";
            pickerBtn.innerHTML = `${window.lucideIconHtml("pipette", { size: 12 })} Cliquez sur la photo...`;
        }

        const handleImageClick = (e) => {
            if (!this.isPickerActive) return;

            e.stopImmediatePropagation();
            e.preventDefault();

            const rect = targetCanvas.getBoundingClientRect();
            const x = Math.floor((e.clientX - rect.left) * (targetCanvas.width / rect.width));
            const y = Math.floor((e.clientY - rect.top) * (targetCanvas.height / rect.height));

            const imgCtx = targetCanvas.getContext("2d");
            if (imgCtx) {
                const pixel = imgCtx.getImageData(x, y, 1, 1).data;
                let val;
                if (this.activeChannel === "red") val = pixel[0];
                else if (this.activeChannel === "green") val = pixel[1];
                else if (this.activeChannel === "blue") val = pixel[2];
                else val = Math.round(0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2]);

                this.addPointAtVal(val);
            }

            this.isPickerActive = false;
            targetCanvas.style.cursor = originalCursor || "default";

            window.removeEventListener("wheel", blockNavigation, { capture: true });
            window.removeEventListener("mousedown", blockNavigation, { capture: true });

            if (pickerBtn) {
                pickerBtn.style.background = "#2d3748";
                pickerBtn.style.borderColor = "#319795";
                pickerBtn.style.color = "#319795";
                pickerBtn.innerHTML = `${window.lucideIconHtml("pipette", { size: 12 })} Pipette : Point depuis photo`;
            }
        };

        window.addEventListener("click", handleImageClick, { capture: true, once: true });
    }

    addPointAtVal(val) {
        const exists = this.points.some(p => Math.abs(p.x - val) < 8);
        if (!exists) {
            this.points.push({ x: val, y: val });
            this.points.sort((a, b) => a.x - b.x);
            this.selectedPointIndex = this.points.findIndex(p => p.x === val);
            this.update();
        }
    }

    getCanvasCoords(e) {
        if (!this.canvas) return { x: 0, y: 0 };
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = Math.max(0, Math.min(this.size, e.clientX - rect.left));
        const mouseY = Math.max(0, Math.min(this.size, e.clientY - rect.top));

        return {
            x: (mouseX / this.size) * 255,
            y: (1 - mouseY / this.size) * 255
        };
    }

    onMouseDown(e) {
        const coords = this.getCanvasCoords(e);
        const radius = 12;

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

    getLUT() {
        const lut = new Uint8Array(256);
        
        for (let x = 0; x < 256; x++) {
            let i = 0;
            while (i < this.points.length - 1 && this.points[i + 1].x < x) {
                i++;
            }

            if (i >= this.points.length - 1) {
                lut[x] = Math.round(this.points[this.points.length - 1].y);
                continue;
            }

            const p1 = this.points[i];
            const p2 = this.points[i + 1];
            const t = (x - p1.x) / (p2.x - p1.x || 1);

            let y;
            if (this.curveType === "linear") {
                y = p1.y + t * (p2.y - p1.y);
            } else {
                const p0 = this.points[Math.max(0, i - 1)];
                const p3 = this.points[Math.min(this.points.length - 1, i + 2)];

                const t2 = t * t;
                const t3 = t2 * t;

                y = 0.5 * (
                    (2 * p1.y) +
                    (-p0.y + p2.y) * t +
                    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
                );
            }

            lut[x] = Math.min(255, Math.max(0, Math.round(y)));
        }

        return lut;
    }

    getAllLUTs() {
        const currentBackup = this.activeChannel;
        const result = {};
        
        ["rgb", "red", "green", "blue"].forEach(ch => {
            this.activeChannel = ch;
            result[ch] = this.getLUT();
        });

        this.activeChannel = currentBackup;
        return result;
    }

    draw() {
        if (!this.ctx) return;

        const w = this.size;
        const h = this.size;
        this.ctx.clearRect(0, 0, w, h);

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

        this.ctx.strokeStyle = "#3a3a3a";
        this.ctx.setLineDash([4, 4]);
        this.ctx.beginPath();
        this.ctx.moveTo(0, h);
        this.ctx.lineTo(w, 0);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        const channelColors = {
            rgb:   "#00aaff",
            red:   "#ff4d4d",
            green: "#4dff4d",
            blue:  "#4d94ff"
        };
        const currentColor = channelColors[this.activeChannel] || "#00aaff";

        const lut = this.getLUT();
        this.ctx.strokeStyle = currentColor;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();

        for (let x = 0; x < 256; x++) {
            const px = (x / 255) * w;
            const py = (1 - lut[x] / 255) * h;
            if (x === 0) this.ctx.moveTo(px, py);
            else this.ctx.lineTo(px, py);
        }
        this.ctx.stroke();

        this.points.forEach((pt, idx) => {
            const px = (pt.x / 255) * w;
            const py = (1 - pt.y / 255) * h;

            this.ctx.beginPath();
            this.ctx.arc(px, py, 5, 0, Math.PI * 2);
            this.ctx.fillStyle = idx === this.selectedPointIndex ? "#ffffff" : currentColor;
            this.ctx.fill();
            this.ctx.strokeStyle = "#111111";
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();
        });
    }

    update() {
        this.draw();
        if (typeof this.onChange === "function") {
            this.onChange(this.getAllLUTs());
        }
    }
}

if (typeof window !== "undefined") {
    window.ToneCurveWidget = ToneCurveWidget;
}