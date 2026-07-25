let originalPictureControl = null;

/*=========================================================
    Construction du panneau
=========================================================*/

function updatePictureControl(info) {

    const panel = document.getElementById("pictureControlStatus");

    if (!panel)
        return;

    if (!info.pictureControl) {

        panel.innerHTML = "Aucun Picture Control chargé.";

        return;

    }

    originalPictureControl = structuredClone(info.pictureControl);

    const pc = info.pictureControl;

    panel.innerHTML = `

        <h2>Picture Control Nikon</h2>

        ${createSlider("Netteté","sharpning",pc.sharpning,-3,9)}

        ${createSlider("Netteté moyenne","midRangeSharpning",pc.midRangeSharpning,-5,5)}

        ${createSlider("Clarté","clarity",pc.clarity,-5,5)}

        ${createSlider("Contraste","contrast",pc.contrast,-3,3)}

        ${createSlider("Hautes lumières","highlights",pc.highlights,-5,5)}

        ${createSlider("Ombres","shadows",pc.shadows,-5,5)}

        ${createSlider("Saturation","saturation",pc.saturation,-3,3)}

        <br><br>

        <button id="resetPC">
            Réinitialiser
        </button>

    `;

    activateSliders();

}


/*=========================================================
    Curseur
=========================================================*/

function createSlider(label,id,value,min,max){

    return `

    <div class="pc-row">

        <div class="pc-label">

            <span>${label}</span>

            <span class="pc-value" id="${id}-value">

                ${value}

            </span>

        </div>

        <input

            class="pc-slider"

            id="${id}"

            type="range"

            min="${min}"

            max="${max}"

            value="${value}"

            step="1"

        >

    </div>

    `;

}


/*=========================================================
    Evènements
=========================================================*/

function activateSliders(){

    document.querySelectorAll(".pc-slider").forEach(slider=>{

        slider.addEventListener("input", async ()=>{

            const value = Number(slider.value);

            document.getElementById(
                slider.id+"-value"
            ).textContent = value;

            const pc = await window.electronAPI.updatePC(
                slider.id,
                value
            );

            window.imageProcessor.setPictureControl(pc);

            console.log(pc);

        });

    });

    document.getElementById("resetPC").addEventListener("click",()=>{

        updatePictureControl({

            pictureControl: structuredClone(originalPictureControl)

        });

    });

}

window.updatePictureControl = updatePictureControl;