/*=========================================================
    Pixel RAW - Hydratation des icônes statiques du HTML
    Cherche tous les éléments [data-icon="nom"] et insère l'icône Lucide
    correspondante en tête de leur contenu (icon.html avec attributs
    data-icon-size / data-icon-filled optionnels).
=========================================================*/
function hydrateStaticIcons(root = document) {
    root.querySelectorAll("[data-icon]").forEach((el) => {
        const name = el.dataset.icon;
        const size = el.dataset.iconSize ? parseInt(el.dataset.iconSize, 10) : 14;
        const filled = el.dataset.iconFilled === "true";
        const html = window.lucideIconHtml(name, { size, filled });
        if (html) el.insertAdjacentHTML("afterbegin", html);
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => hydrateStaticIcons());
} else {
    hydrateStaticIcons();
}

if (typeof window !== "undefined") {
    window.hydrateStaticIcons = hydrateStaticIcons;
}
