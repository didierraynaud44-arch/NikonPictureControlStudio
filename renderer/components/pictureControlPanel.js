function updatePictureControl(info) {

    const pc = document.getElementById("pictureControlStatus");

    if (!pc) {
        console.error("Zone Picture Control introuvable");
        return;
    }


    if (!info.pictureControl) {

        pc.innerHTML = "Aucun Picture Control détecté.";

        return;
    }


    const data = info.pictureControl;
console.log("Picture Control :", data);

    pc.innerHTML = `

        <h2>Picture Control Nikon</h2>


        <div class="pc-row">

            <div class="pc-label">
                <span>Nom</span>
            </div>

            <select class="pc-select" id="pc-name">

                <option ${data.name === "Neutral" ? "selected" : ""}>
                    Neutral
                </option>

                <option ${data.name === "Standard" ? "selected" : ""}>
                    Standard
                </option>

                <option ${data.name === "Vivid" ? "selected" : ""}>
                    Vivid
                </option>

                <option ${data.name === "Monochrome" ? "selected" : ""}>
                    Monochrome
                </option>

            </select>

        </div>


      ${createSlider("Netteté", "sharpness", 0, -3, 9)}

${createSlider("Contraste", "contrast", 0, -3, 3)}

${createSlider("Luminosité", "brightness", 0, -1, 1)}

${createSlider("Saturation", "saturation", 0, -3, 3)}

${createSlider("Teinte", "hue", 0, -3, 3)}


        <br>

        <button id="resetPC">
            Réinitialiser
        </button>

    `;


    activateSliders();

}


function createSlider(label, id, value, min, max) {


    return `

    <div class="pc-row">


        <div class="pc-label">

            <span>${label}</span>

            <span 
            class="pc-value" 
            id="${id}-value">
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


function activateSliders() {


    const sliders = document.querySelectorAll(".pc-slider");


    sliders.forEach(slider => {


        slider.addEventListener("input", () => {


            document.getElementById(
                slider.id + "-value"
            ).innerHTML = slider.value;


        });


    });


}



window.updatePictureControl = updatePictureControl;