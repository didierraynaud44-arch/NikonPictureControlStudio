console.log("Nikon Picture Control Studio");


const button = document.getElementById("openNef");


button.addEventListener("click", async () => {


    const file = await window.electronAPI.openNEF();


    if (file) {

        document.getElementById("status").innerText =
            "Fichier sélectionné :\n" + file;

        console.log(file);

    }

});