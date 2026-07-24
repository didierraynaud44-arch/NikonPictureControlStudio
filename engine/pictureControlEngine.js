let currentPC = null;

function setPC(pc) {

    currentPC = structuredClone(pc);

    return currentPC;

}

function getPC() {

    return currentPC;

}

function updatePC(property, value) {

    if (!currentPC)
        return null;

    currentPC[property] = value;

    return currentPC;

}

module.exports = {

    setPC,
    getPC,
    updatePC

};