/*
I just figured a new trick today.Use https://cssgradient.io/ (or a similar tool) to generate a css gradient.

Then ask ChatGPT: "Can you convert this gradient to a FastLED palette using DEFINE_GRADIENT_PALETTE()"
*/

CRGBPalette16 GoldenDecay_p = CRGBPalette16(
    CRGB(174,252,221), // 0
    CRGB(174,252,221), // 1
    CRGB(174,252,221), // 2
    CRGB(174,252,221), // 3

    CRGB(230,213, 62), // 4
    CRGB(230,213, 62), // 5
    CRGB(230,213, 62), // 6
    CRGB(230,213, 62), // 7

    CRGB(230,213, 62), // 8
    CRGB(230,213, 62), // 9
    CRGB(230,213, 62), // 10
    CRGB(230,213, 62), // 11

    CRGB( 66,  3, 16), // 12
    CRGB( 66,  3, 16), // 13
    CRGB( 66,  3, 16), // 14
    CRGB( 66,  3, 16)  // 15
);