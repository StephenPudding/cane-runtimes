import type { RuntimeTextureV1 } from "@cane-runtime/core";

/** Packed into the normalized alpha byte of Cocos' second vertex color. */
export const CANE_COCOS_COLOR_FLAG_TWO_COLOR_V1 = 1;
export const CANE_COCOS_COLOR_FLAG_TEXTURE_LINEAR_V1 = 2;
export const CANE_COCOS_COLOR_FLAG_TEXTURE_PREMULTIPLIED_V1 = 4;

export interface CaneCocosPixelInputV1 {
  readonly textureRgba: readonly [number, number, number, number];
  readonly textureColorSpace: RuntimeTextureV1["colorSpace"];
  readonly textureAlphaMode: RuntimeTextureV1["alphaMode"];
  readonly lightRgb: readonly [number, number, number];
  readonly darkRgb: readonly [number, number, number] | null;
  readonly alpha: number;
}

/**
 * Returns the encoded, premultiplied pixel emitted by the Cane Cocos shader.
 * This CPU projection exists for deterministic pixel-contract tests; rendering
 * uses the equivalent GLSL generated in color-effect.ts.
 */
export function shadeCaneCocosPixelV1(
  input: CaneCocosPixelInputV1,
): readonly [number, number, number, number] {
  const textureAlpha = clampUnitV1(input.textureRgba[3]);
  let textureRed = decodeTextureChannelV1(input.textureRgba[0], input.textureColorSpace);
  let textureGreen = decodeTextureChannelV1(input.textureRgba[1], input.textureColorSpace);
  let textureBlue = decodeTextureChannelV1(input.textureRgba[2], input.textureColorSpace);
  if (input.textureAlphaMode === "premultiplied") {
    if (textureAlpha > 0.000001) {
      textureRed /= textureAlpha;
      textureGreen /= textureAlpha;
      textureBlue /= textureAlpha;
    } else {
      textureRed = 0;
      textureGreen = 0;
      textureBlue = 0;
    }
  }
  textureRed = clampUnitV1(textureRed);
  textureGreen = clampUnitV1(textureGreen);
  textureBlue = clampUnitV1(textureBlue);

  const lightRed = srgbToLinearV1(input.lightRgb[0] / 255);
  const lightGreen = srgbToLinearV1(input.lightRgb[1] / 255);
  const lightBlue = srgbToLinearV1(input.lightRgb[2] / 255);
  let outputRed = textureRed * lightRed;
  let outputGreen = textureGreen * lightGreen;
  let outputBlue = textureBlue * lightBlue;
  if (input.darkRgb !== null) {
    const darkRed = srgbToLinearV1(input.darkRgb[0] / 255);
    const darkGreen = srgbToLinearV1(input.darkRgb[1] / 255);
    const darkBlue = srgbToLinearV1(input.darkRgb[2] / 255);
    outputRed = darkRed + (lightRed - darkRed) * textureRed;
    outputGreen = darkGreen + (lightGreen - darkGreen) * textureGreen;
    outputBlue = darkBlue + (lightBlue - darkBlue) * textureBlue;
  }

  const outputAlpha = clampUnitV1(textureAlpha * input.alpha);
  return [
    linearToSrgbV1(clampUnitV1(outputRed)) * outputAlpha,
    linearToSrgbV1(clampUnitV1(outputGreen)) * outputAlpha,
    linearToSrgbV1(clampUnitV1(outputBlue)) * outputAlpha,
    outputAlpha,
  ];
}

export function caneCocosColorFlagsV1(
  texture: RuntimeTextureV1,
  twoColor: boolean,
): number {
  let flags = twoColor ? CANE_COCOS_COLOR_FLAG_TWO_COLOR_V1 : 0;
  if (texture.colorSpace === "linear") flags |= CANE_COCOS_COLOR_FLAG_TEXTURE_LINEAR_V1;
  if (texture.alphaMode === "premultiplied") flags |= CANE_COCOS_COLOR_FLAG_TEXTURE_PREMULTIPLIED_V1;
  return flags;
}

export function srgbToLinearV1(value: number): number {
  const channel = clampUnitV1(value);
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function linearToSrgbV1(value: number): number {
  const channel = clampUnitV1(value);
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

function decodeTextureChannelV1(
  value: number,
  colorSpace: RuntimeTextureV1["colorSpace"],
): number {
  return colorSpace === "srgb" ? srgbToLinearV1(value) : clampUnitV1(value);
}

function clampUnitV1(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
