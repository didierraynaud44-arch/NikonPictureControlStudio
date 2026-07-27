class ToneCurve {

    static build(pc) {

        const curve = [];

        for (let i = 0; i < 256; i++) {

            curve[i] = i;

        }

        return curve;

    }

}

module.exports = ToneCurve;