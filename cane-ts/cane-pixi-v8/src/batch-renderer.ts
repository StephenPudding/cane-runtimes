import {
  Batcher,
  Buffer,
  BufferUsage,
  ExtensionType,
  Geometry,
  RendererType,
  Shader,
  State,
  compileHighShaderGlProgram,
  compileHighShaderGpuProgram,
  canvasUtils,
  extensions,
  generateTextureBatchBit,
  generateTextureBatchBitGl,
  getMaxTexturesPerBatch,
  getBatchSamplersUniformGroup,
  roundPixelsBit,
  roundPixelsBitGl,
  type Batch,
  type BatchableMeshElement,
  type BatchableQuadElement,
  type BLEND_MODES,
  type CanvasRenderer,
  type CrossPlatformCanvasRenderingContext2D,
  type HighShaderBit,
  type InstructionSet,
  type Matrix,
  type Renderer,
  type RenderPipe,
  type Texture,
  type Topology,
  type WebGPURenderer,
} from "pixi.js";
import type { CanePixiBatchSourceV1, CanePixiBatchView } from "./batch-view.js";

export const CANE_PIXI_BATCHER_NAME_V1 = "cane-v1";
export const CANE_PIXI_LIGHT_BATCHER_NAME_V1 = "cane-v1-light";
export const CANE_PIXI_FALLBACK_TEXTURES_PER_BATCH_V1 = 8;
export const CANE_PIXI_LIGHT_VERTEX_STRIDE_BYTES_V1 = 24;
export const CANE_PIXI_VERTEX_STRIDE_BYTES_V1 = 28;

/** Pixi's maintained Canvas backend is supported as a documented downgrade. */
export const CANE_PIXI_CANVAS_CAPABILITIES_V1 = Object.freeze({
  available: true,
  regionAndMeshGeometry: true,
  clipping: true,
  fullAffine: true,
  blendModes: true,
  exactLightRgbTint: false,
  twoColorTint: false,
  linearLightConversion: false,
} as const);

const FLAG_TWO_COLOR = 1;
const FLAG_TEXTURE_LINEAR = 2;
const FLAG_TEXTURE_PREMULTIPLIED = 4;
const FLAG_OUTPUT_STRAIGHT = 8;

const EMPTY_FLOAT_BUFFER = new Float32Array(1);
const EMPTY_INDEX_BUFFER = new Uint32Array(1);

/** One-color geometry: position, UV, light RGBA, texture id + packed flags. */
export class CanePixiLightBatchGeometryV1 extends Geometry {
  constructor() {
    const attributeBuffer = new Buffer({
      data: EMPTY_FLOAT_BUFFER,
      label: "cane-v1-light-batch-attributes",
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      shrinkToFit: false,
    });
    const indexBuffer = new Buffer({
      data: EMPTY_INDEX_BUFFER,
      label: "cane-v1-light-batch-indices",
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      shrinkToFit: false,
    });

    super({
      attributes: {
        aPosition: {
          buffer: attributeBuffer,
          format: "float32x2",
          stride: CANE_PIXI_LIGHT_VERTEX_STRIDE_BYTES_V1,
          offset: 0,
        },
        aUV: {
          buffer: attributeBuffer,
          format: "float32x2",
          stride: CANE_PIXI_LIGHT_VERTEX_STRIDE_BYTES_V1,
          offset: 8,
        },
        aLight: {
          buffer: attributeBuffer,
          format: "unorm8x4",
          stride: CANE_PIXI_LIGHT_VERTEX_STRIDE_BYTES_V1,
          // Keep the physical layout distinct from Pixi's default 24-byte
          // BatchGeometry. Pixi v8's WebGPU pipeline cache keys layouts by
          // offsets/formats rather than semantic attribute names, so an
          // identical aColor-shaped layout can make the two batchers reuse an
          // incompatible `aColor`/`aLight` buffer-name binding.
          offset: 20,
        },
        aTextureIdAndRound: {
          buffer: attributeBuffer,
          format: "uint16x2",
          stride: CANE_PIXI_LIGHT_VERTEX_STRIDE_BYTES_V1,
          offset: 16,
        },
      },
      indexBuffer,
    });
  }
}

/**
 * Interleaved batch geometry: position, UV, light RGBA, dark RGB + flags,
 * and Pixi's texture-id/round-pixels pair. One vertex occupies 28 bytes.
 */
export class CanePixiBatchGeometryV1 extends Geometry {
  constructor() {
    const attributeBuffer = new Buffer({
      data: EMPTY_FLOAT_BUFFER,
      label: "cane-v1-batch-attributes",
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      shrinkToFit: false,
    });
    const indexBuffer = new Buffer({
      data: EMPTY_INDEX_BUFFER,
      label: "cane-v1-batch-indices",
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      shrinkToFit: false,
    });

    super({
      attributes: {
        aPosition: {
          buffer: attributeBuffer,
          format: "float32x2",
          stride: CANE_PIXI_VERTEX_STRIDE_BYTES_V1,
          offset: 0,
        },
        aUV: {
          buffer: attributeBuffer,
          format: "float32x2",
          stride: CANE_PIXI_VERTEX_STRIDE_BYTES_V1,
          offset: 8,
        },
        aLight: {
          buffer: attributeBuffer,
          format: "unorm8x4",
          stride: CANE_PIXI_VERTEX_STRIDE_BYTES_V1,
          offset: 16,
        },
        aDarkAndFlags: {
          buffer: attributeBuffer,
          format: "unorm8x4",
          stride: CANE_PIXI_VERTEX_STRIDE_BYTES_V1,
          offset: 20,
        },
        aTextureIdAndRound: {
          buffer: attributeBuffer,
          format: "uint16x2",
          stride: CANE_PIXI_VERTEX_STRIDE_BYTES_V1,
          offset: 24,
        },
      },
      indexBuffer,
    });
  }
}

class CanePixiBatchShaderV1 extends Shader {
  readonly maxTextures: number;

  constructor(maxTextures: number) {
    const glProgram = compileHighShaderGlProgram({
      name: "cane-v1-batch",
      bits: [
        caneTintBitGl,
        generateTextureBatchBitGl(maxTextures),
        roundPixelsBitGl,
      ],
    });
    const gpuProgram = compileHighShaderGpuProgram({
      name: "cane-v1-batch",
      bits: [
        caneTintBit,
        generateTextureBatchBit(maxTextures),
        roundPixelsBit,
      ],
    });
    super({
      glProgram,
      gpuProgram,
      resources: {
        batchSamplers: getBatchSamplersUniformGroup(maxTextures),
      },
    });
    this.maxTextures = maxTextures;
  }
}

class CanePixiLightBatchShaderV1 extends Shader {
  readonly maxTextures: number;

  constructor(maxTextures: number) {
    const glProgram = compileHighShaderGlProgram({
      name: "cane-v1-light-batch",
      bits: [
        caneLightTintBitGl,
        generateTextureBatchBitGl(maxTextures),
        roundPixelsBitGl,
      ],
    });
    const gpuProgram = compileHighShaderGpuProgram({
      name: "cane-v1-light-batch",
      bits: [
        caneLightTintBit,
        generateTextureBatchBit(maxTextures),
        roundPixelsBit,
      ],
    });
    super({
      glProgram,
      gpuProgram,
      resources: {
        batchSamplers: getBatchSamplersUniformGroup(maxTextures),
      },
    });
    this.maxTextures = maxTextures;
  }
}

let sharedShader: CanePixiBatchShaderV1 | null = null;
let sharedLightShader: CanePixiLightBatchShaderV1 | null = null;
let detectedMaxTexturesPerBatch: number | null = null;

/**
 * Pixi custom batchers are constructed without a Renderer argument. Use the
 * same cached WebGL capability probe as Pixi/Spine and retain a conservative
 * fallback for WebGPU-only or restricted browser environments.
 */
export function getCanePixiMaxTexturesPerBatchV1(): number {
  if (detectedMaxTexturesPerBatch !== null) return detectedMaxTexturesPerBatch;
  try {
    const detected = getMaxTexturesPerBatch();
    detectedMaxTexturesPerBatch = Number.isSafeInteger(detected) && detected > 0
      ? Math.min(detected, 0xffff)
      : CANE_PIXI_FALLBACK_TEXTURES_PER_BATCH_V1;
  } catch {
    detectedMaxTexturesPerBatch = CANE_PIXI_FALLBACK_TEXTURES_PER_BATCH_V1;
  }
  return detectedMaxTexturesPerBatch;
}

export class CanePixiLightBatcherV1 extends Batcher {
  static readonly extension = {
    type: [ExtensionType.Batcher],
    name: CANE_PIXI_LIGHT_BATCHER_NAME_V1,
  } as const;

  readonly name = CANE_PIXI_LIGHT_BATCHER_NAME_V1;
  readonly geometry = new CanePixiLightBatchGeometryV1();
  readonly vertexSize = CANE_PIXI_LIGHT_VERTEX_STRIDE_BYTES_V1 / 4;
  shader: CanePixiLightBatchShaderV1;

  constructor() {
    const maxTextures = getCanePixiMaxTexturesPerBatchV1();
    super({
      maxTextures,
      attributesInitialSize: 256 * (CANE_PIXI_LIGHT_VERTEX_STRIDE_BYTES_V1 / 4),
      indicesInitialSize: 384,
    });
    sharedLightShader ??= new CanePixiLightBatchShaderV1(maxTextures);
    this.shader = sharedLightShader;
  }

  override packAttributes(
    batchable: BatchableMeshElement,
    float32View: Float32Array,
    uint32View: Uint32Array,
    index: number,
    textureId: number,
  ): void {
    const element = batchable as CanePixiBatchElementV1;
    const transform = element.transform;
    const positions = element.positions;
    const uvs = element.uvs;
    const source = element.source;
    const groupColorAlpha = element.renderable.groupColorAlpha;
    const groupRed = groupColorAlpha & 0xff;
    const groupGreen = (groupColorAlpha >>> 8) & 0xff;
    const groupBlue = (groupColorAlpha >>> 16) & 0xff;
    const groupAlpha = (groupColorAlpha >>> 24) & 0xff;
    const light = source.lightRgb;
    const lightPacked = packRgbaBytes(
      multiplyColorByte(light[0], groupRed),
      multiplyColorByte(light[1], groupGreen),
      multiplyColorByte(light[2], groupBlue),
      clampByte(Math.round(source.alpha * groupAlpha)),
    );
    const flags = source.materialFlags
      | (element.blendMode === "add-npm" ? FLAG_OUTPUT_STRAIGHT : 0);
    const roundAndFlags = (element.roundPixels & 1) | (flags << 1);
    const textureIdAndRound = (textureId << 16) | (roundAndFlags & 0xffff);
    const end = element.attributeOffset + element.attributeSize;

    for (let vertex = element.attributeOffset; vertex < end; vertex += 1) {
      const component = vertex * 2;
      const x = positions[component] ?? 0;
      const y = -(positions[component + 1] ?? 0);
      float32View[index] = transform.a * x + transform.c * y + transform.tx;
      float32View[index + 1] = transform.d * y + transform.b * x + transform.ty;
      float32View[index + 2] = uvs[component] ?? 0;
      float32View[index + 3] = uvs[component + 1] ?? 0;
      uint32View[index + 4] = textureIdAndRound;
      uint32View[index + 5] = lightPacked;
      index += this.vertexSize;
    }
  }

  override packQuadAttributes(
    element: BatchableQuadElement,
    _float32View: Float32Array,
    _uint32View: Uint32Array,
    _index: number,
    _textureId: number,
  ): void {
    throw new TypeError(`Cane light batch element '${String(element)}' cannot use quad packing.`);
  }

  override destroy(): void {
    this.shader = null as unknown as CanePixiLightBatchShaderV1;
    super.destroy();
  }
}

export class CanePixiBatcherV1 extends Batcher {
  static readonly extension = {
    type: [ExtensionType.Batcher],
    name: CANE_PIXI_BATCHER_NAME_V1,
  } as const;

  readonly name = CANE_PIXI_BATCHER_NAME_V1;
  readonly geometry = new CanePixiBatchGeometryV1();
  readonly vertexSize = CANE_PIXI_VERTEX_STRIDE_BYTES_V1 / 4;
  shader: CanePixiBatchShaderV1;

  constructor() {
    const maxTextures = getCanePixiMaxTexturesPerBatchV1();
    super({
      maxTextures,
      attributesInitialSize: 256 * (CANE_PIXI_VERTEX_STRIDE_BYTES_V1 / 4),
      indicesInitialSize: 384,
    });
    sharedShader ??= new CanePixiBatchShaderV1(maxTextures);
    this.shader = sharedShader;
  }

  override packAttributes(
    batchable: BatchableMeshElement,
    float32View: Float32Array,
    uint32View: Uint32Array,
    index: number,
    textureId: number,
  ): void {
    const element = batchable as CanePixiBatchElementV1;
    const transform = element.transform;
    const positions = element.positions;
    const uvs = element.uvs;
    const source = element.source;
    const groupColorAlpha = element.renderable.groupColorAlpha;
    const groupRed = groupColorAlpha & 0xff;
    const groupGreen = (groupColorAlpha >>> 8) & 0xff;
    const groupBlue = (groupColorAlpha >>> 16) & 0xff;
    const groupAlpha = (groupColorAlpha >>> 24) & 0xff;
    const light = source.lightRgb;
    const dark = source.darkRgb;
    const lightPacked = packRgbaBytes(
      multiplyColorByte(light[0], groupRed),
      multiplyColorByte(light[1], groupGreen),
      multiplyColorByte(light[2], groupBlue),
      clampByte(Math.round(source.alpha * groupAlpha)),
    );
    const outputFlags = source.materialFlags
      | (element.blendMode === "add-npm" ? FLAG_OUTPUT_STRAIGHT : 0);
    const darkPacked = packRgbaBytes(
      multiplyColorByte(dark[0], groupRed),
      multiplyColorByte(dark[1], groupGreen),
      multiplyColorByte(dark[2], groupBlue),
      outputFlags,
    );
    const textureIdAndRound = (textureId << 16) | (element.roundPixels & 0xffff);
    const end = element.attributeOffset + element.attributeSize;

    for (let vertex = element.attributeOffset; vertex < end; vertex += 1) {
      const component = vertex * 2;
      const x = positions[component] ?? 0;
      const y = -(positions[component + 1] ?? 0);
      float32View[index] = transform.a * x + transform.c * y + transform.tx;
      float32View[index + 1] = transform.d * y + transform.b * x + transform.ty;
      float32View[index + 2] = uvs[component] ?? 0;
      float32View[index + 3] = uvs[component + 1] ?? 0;
      uint32View[index + 4] = lightPacked;
      uint32View[index + 5] = darkPacked;
      uint32View[index + 6] = textureIdAndRound;
      index += this.vertexSize;
    }
  }

  override packQuadAttributes(
    element: BatchableQuadElement,
    _float32View: Float32Array,
    _uint32View: Uint32Array,
    _index: number,
    _textureId: number,
  ): void {
    throw new TypeError(`Cane batch element '${String(element)}' cannot use quad packing.`);
  }

  override destroy(): void {
    this.shader = null as unknown as CanePixiBatchShaderV1;
    super.destroy();
  }
}

class CanePixiBatchElementV1 implements BatchableMeshElement {
  readonly topology: Topology = "triangle-list";
  readonly packAsQuad = false;
  readonly indexOffset = 0;
  readonly attributeOffset = 0;
  readonly renderable: CanePixiBatchView;
  source: CanePixiBatchSourceV1;
  texture: Texture;
  blendMode: BLEND_MODES;
  roundPixels: 0 | 1;
  _textureId = 0;
  _attributeStart = 0;
  _indexStart = 0;
  _batcher!: Batcher;
  _batch!: Batch;

  constructor(renderable: CanePixiBatchView, source: CanePixiBatchSourceV1) {
    this.renderable = renderable;
    this.source = source;
    this.texture = source.texture;
    this.blendMode = effectiveBlendMode(renderable, source);
    this.roundPixels = renderable._roundPixels;
  }

  get batcherName(): string {
    return (this.source.materialFlags & FLAG_TWO_COLOR) !== 0
      ? CANE_PIXI_BATCHER_NAME_V1
      : CANE_PIXI_LIGHT_BATCHER_NAME_V1;
  }

  get positions(): number[] | Float32Array {
    return this.source.worldVerticesXy as number[];
  }

  get uvs(): number[] | Float32Array {
    return this.source.uvs as number[];
  }

  get indices(): number[] | Uint32Array {
    return this.source.indices;
  }

  get transform(): Matrix {
    return this.renderable.groupTransform;
  }

  get attributeSize(): number {
    return this.source.worldVerticesXy.length / 2;
  }

  get indexSize(): number {
    return this.source.indices.length;
  }

  sync(source: CanePixiBatchSourceV1): void {
    this.source = source;
    this.texture = source.texture;
    this.blendMode = effectiveBlendMode(this.renderable, source);
    this.roundPixels = this.renderable._roundPixels;
  }

  destroy(): void {
    this._batcher = null as unknown as Batcher;
    this._batch = null as unknown as Batch;
  }
}

class CanePixiGpuDataV1 {
  structureVersion = -1;
  readonly elements: CanePixiBatchElementV1[] = [];
  readonly elementsBySource = new Map<CanePixiBatchSourceV1, CanePixiBatchElementV1>();

  destroy(): void {
    for (const element of this.elementsBySource.values()) element.destroy();
    this.elementsBySource.clear();
    this.elements.length = 0;
  }
}

export class CanePixiBatchPipeV1 implements RenderPipe<CanePixiBatchView> {
  static readonly extension = {
    type: [ExtensionType.WebGLPipes, ExtensionType.WebGPUPipes],
    name: CANE_PIXI_BATCHER_NAME_V1,
  } as const;

  readonly #renderer: Renderer;
  readonly #preparedWebGpuBatchers = new Set<Batcher>();

  constructor(renderer: Renderer) {
    this.#renderer = renderer;
  }

  validateRenderable(view: CanePixiBatchView): boolean {
    const data = this.#gpuData(view);
    if (data.structureVersion !== view.structureVersion
      || data.elements.length !== view.activeBatchSources.length) return true;

    for (let index = 0; index < data.elements.length; index += 1) {
      const element = data.elements[index];
      const source = view.activeBatchSources[index];
      if (element === undefined || source === undefined || element.source !== source) return true;
      const nextBlend = effectiveBlendMode(view, source);
      if (element.blendMode !== nextBlend) return true;
      if (element.texture !== source.texture) {
        if (!element._batcher.checkAndUpdateTexture(element, source.texture)) return true;
        element.texture = source.texture;
      }
    }
    return false;
  }

  addRenderable(view: CanePixiBatchView, instructionSet: InstructionSet): void {
    const data = this.#gpuData(view);
    this.#syncStructure(data, view);
    const batchPipe = this.#renderer.renderPipes.batch;
    for (let index = 0; index < data.elements.length; index += 1) {
      const element = data.elements[index];
      if (element !== undefined) batchPipe.addToBatch(element, instructionSet);
    }
    this.#prepareWebGpuLayouts(data.elements);
  }

  updateRenderable(view: CanePixiBatchView): void {
    const data = this.#gpuData(view);
    for (let index = 0; index < data.elements.length; index += 1) {
      const element = data.elements[index];
      const source = view.activeBatchSources[index];
      if (element === undefined || source === undefined) continue;
      element.sync(source);
      element._batcher.updateElement(element);
    }
  }

  destroy(): void {
    this.#preparedWebGpuBatchers.clear();
    // Per-view GPU data is owned and released by ViewContainer.unload().
  }

  /**
   * Pixi's WebGPU batch adaptor binds geometry before its first pipeline lookup.
   * A custom batcher's private layout key is therefore still zero and can alias
   * another batcher's attribute-name cache (for example aLight vs aColor).
   * An official pipeline lookup primes that key once before execution.
   */
  #prepareWebGpuLayouts(elements: readonly CanePixiBatchElementV1[]): void {
    if (this.#renderer.type !== RendererType.WEBGPU) return;
    const renderer = this.#renderer as WebGPURenderer;
    for (const element of elements) {
      const batcher = element._batcher;
      if (this.#preparedWebGpuBatchers.has(batcher)) continue;
      renderer.pipeline.getPipeline(
        batcher.geometry,
        batcher.shader.gpuProgram,
        State.default2d,
      );
      this.#preparedWebGpuBatchers.add(batcher);
    }
  }

  #gpuData(view: CanePixiBatchView): CanePixiGpuDataV1 {
    const existing = view._gpuData[this.#renderer.uid];
    if (existing !== undefined) return existing;
    const created = new CanePixiGpuDataV1();
    view._gpuData[this.#renderer.uid] = created;
    return created;
  }

  #syncStructure(data: CanePixiGpuDataV1, view: CanePixiBatchView): void {
    if (data.structureVersion === view.structureVersion
      && data.elements.length === view.activeBatchSources.length) {
      for (let index = 0; index < data.elements.length; index += 1) {
        const element = data.elements[index];
        const source = view.activeBatchSources[index];
        if (element !== undefined && source !== undefined) element.sync(source);
      }
      return;
    }
    for (const [source, element] of data.elementsBySource) {
      if (source.cached) continue;
      element.destroy();
      data.elementsBySource.delete(source);
    }
    if (data.elements.length === view.activeBatchSources.length) {
      let sameOrder = true;
      for (let index = 0; index < data.elements.length; index += 1) {
        if (data.elements[index]?.source !== view.activeBatchSources[index]) {
          sameOrder = false;
          break;
        }
      }
      if (sameOrder) {
        for (let index = 0; index < data.elements.length; index += 1) {
          const element = data.elements[index];
          const source = view.activeBatchSources[index];
          if (element !== undefined && source !== undefined) element.sync(source);
        }
        data.structureVersion = view.structureVersion;
        return;
      }
    }
    data.elements.length = view.activeBatchSources.length;
    for (let index = 0; index < view.activeBatchSources.length; index += 1) {
      const source = view.activeBatchSources[index];
      if (source === undefined) continue;
      let element = data.elementsBySource.get(source);
      if (element === undefined) {
        element = new CanePixiBatchElementV1(view, source);
        data.elementsBySource.set(source, element);
      } else {
        element.sync(source);
      }
      data.elements[index] = element;
    }
    data.structureVersion = view.structureVersion;
  }
}

/**
 * Canvas2D downgrade for Core-authored Region/Mesh triangles.
 *
 * It preserves geometry, UVs, alpha, affine transforms, Core CPU clipping and
 * Canvas-supported blend modes. Canvas2D has no shader stage, so RGB light
 * tint, two-color dark tint and explicit linear-light conversion are omitted;
 * callers can inspect `CANE_PIXI_CANVAS_CAPABILITIES_V1` before selecting it.
 */
export class CanePixiCanvasPipeV1 implements RenderPipe<CanePixiBatchView> {
  static readonly extension = {
    type: [ExtensionType.CanvasPipes],
    name: CANE_PIXI_BATCHER_NAME_V1,
  } as const;

  readonly #renderer: CanvasRenderer;

  constructor(renderer: Renderer) {
    this.#renderer = renderer as CanvasRenderer;
  }

  validateRenderable(_view: CanePixiBatchView): boolean {
    return false;
  }

  addRenderable(view: CanePixiBatchView, instructionSet: InstructionSet): void {
    this.#renderer.renderPipes.batch.break(instructionSet);
    instructionSet.add(view);
  }

  updateRenderable(_view: CanePixiBatchView): void {}

  execute(view: CanePixiBatchView): void {
    if (!view.isRenderable) return;
    const contextSystem = this.#renderer.canvasContext;
    const context = contextSystem.activeContext;
    contextSystem.setContextTransform(view.groupTransform, view._roundPixels !== 0);
    const groupAlpha = ((view.groupColorAlpha >>> 24) & 0xff) / 255;

    for (let sourceIndex = 0; sourceIndex < view.activeBatchSources.length; sourceIndex += 1) {
      const source = view.activeBatchSources[sourceIndex];
      if (source === undefined || source.alpha <= 0 || groupAlpha <= 0) continue;
      const image = canvasUtils.getCanvasSource(source.texture);
      if (image === null) continue;
      const smooth = source.texture.source.style.scaleMode !== "nearest";
      if (context[contextSystem.smoothProperty] !== smooth) {
        context[contextSystem.smoothProperty] = smooth;
      }
      contextSystem.setBlendMode(effectiveBlendMode(view, source));
      context.globalAlpha = source.alpha * groupAlpha;
      const width = source.texture.source.pixelWidth;
      const height = source.texture.source.pixelHeight;
      for (let offset = 0; offset < source.indices.length; offset += 3) {
        const i0 = source.indices[offset];
        const i1 = source.indices[offset + 1];
        const i2 = source.indices[offset + 2];
        if (i0 === undefined || i1 === undefined || i2 === undefined) continue;
        drawCanvasTextureTriangleV1(
          context,
          image,
          source.worldVerticesXy,
          source.uvs,
          i0,
          i1,
          i2,
          width,
          height,
        );
      }
    }
    context.globalAlpha = 1;
  }

  destroy(): void {}
}

let installed = false;

/** Register the Cane batcher and render pipe. Call before creating a Pixi renderer. */
export function installCanePixiBatchRendererV1(): void {
  if (installed) return;
  extensions.add(
    CanePixiLightBatcherV1,
    CanePixiBatcherV1,
    CanePixiBatchPipeV1,
    CanePixiCanvasPipeV1,
  );
  installed = true;
}

function drawCanvasTextureTriangleV1(
  context: CrossPlatformCanvasRenderingContext2D,
  image: CanvasImageSource,
  positions: readonly number[],
  uvs: readonly number[],
  i0: number,
  i1: number,
  i2: number,
  textureWidth: number,
  textureHeight: number,
): void {
  const p0 = i0 * 2;
  const p1 = i1 * 2;
  const p2 = i2 * 2;
  const x0 = positions[p0];
  const y0 = positions[p0 + 1];
  const x1 = positions[p1];
  const y1 = positions[p1 + 1];
  const x2 = positions[p2];
  const y2 = positions[p2 + 1];
  const u0 = uvs[p0];
  const v0 = uvs[p0 + 1];
  const u1 = uvs[p1];
  const v1 = uvs[p1 + 1];
  const u2 = uvs[p2];
  const v2 = uvs[p2 + 1];
  if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined
    || x2 === undefined || y2 === undefined || u0 === undefined || v0 === undefined
    || u1 === undefined || v1 === undefined || u2 === undefined || v2 === undefined) return;

  const sx0 = u0 * textureWidth;
  const sy0 = v0 * textureHeight;
  const sx1 = u1 * textureWidth;
  const sy1 = v1 * textureHeight;
  const sx2 = u2 * textureWidth;
  const sy2 = v2 * textureHeight;
  const dx0 = x0;
  const dy0 = -y0;
  const dx1 = x1;
  const dy1 = -y1;
  const dx2 = x2;
  const dy2 = -y2;
  const denominator = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= Number.EPSILON) return;

  const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / denominator;
  const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / denominator;
  const tx = (dx0 * (sx1 * sy2 - sx2 * sy1)
    + dx1 * (sx2 * sy0 - sx0 * sy2)
    + dx2 * (sx0 * sy1 - sx1 * sy0)) / denominator;
  const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / denominator;
  const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / denominator;
  const ty = (dy0 * (sx1 * sy2 - sx2 * sy1)
    + dy1 * (sx2 * sy0 - sx0 * sy2)
    + dy2 * (sx0 * sy1 - sx1 * sy0)) / denominator;

  context.save();
  context.beginPath();
  context.moveTo(dx0, dy0);
  context.lineTo(dx1, dy1);
  context.lineTo(dx2, dy2);
  context.closePath();
  context.clip();
  context.transform(a, b, c, d, tx, ty);
  context.drawImage(image, 0, 0, textureWidth, textureHeight);
  context.restore();
}

function effectiveBlendMode(view: CanePixiBatchView, source: CanePixiBatchSourceV1): BLEND_MODES {
  const blendMode = view.groupBlendMode === "normal" ? source.blendMode : view.groupBlendMode;
  // Pixi's add-npm state provides exact source/destination alpha addition on
  // both WebGL and WebGPU. The shader emits straight RGB only for this state.
  return blendMode === "add" ? "add-npm" : blendMode;
}

function multiplyColorByte(left: number, right: number): number {
  return Math.floor((left * right + 127) / 255);
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function packRgbaBytes(red: number, green: number, blue: number, alpha: number): number {
  return (red | (green << 8) | (blue << 16) | (alpha << 24)) >>> 0;
}

const caneLightTintBit: HighShaderBit = {
  name: "cane-v1-light-tint",
  vertex: {
    header: /* wgsl */`
      @in aLight: vec4<f32>;
      @out vLight: vec4<f32>;
      @out @interpolate(flat) vCaneFlags: u32;
    `,
    main: /* wgsl */`
      vLight = aLight;
      vCaneFlags = aTextureIdAndRound.x >> 1u;
    `,
    end: /* wgsl */`
      if ((aTextureIdAndRound.x & 1u) == 1u && aTextureIdAndRound.x != 1u) {
        vPosition = vec4<f32>(
          roundPixels(vPosition.xy, globalUniforms.uResolution),
          vPosition.zw
        );
      }
    `,
  },
  fragment: {
    header: /* wgsl */`
      @in vLight: vec4<f32>;
      @in @interpolate(flat) vCaneFlags: u32;

      fn caneLightSrgbToLinear(channel: f32) -> f32 {
        if (channel <= 0.04045) {
          return channel / 12.92;
        }
        return pow((channel + 0.055) / 1.055, 2.4);
      }

      fn caneLightLinearToSrgb(channel: f32) -> f32 {
        if (channel <= 0.0031308) {
          return channel * 12.92;
        }
        return 1.055 * pow(channel, 1.0 / 2.4) - 0.055;
      }

      fn caneLightDecodeSrgb(value: vec3<f32>) -> vec3<f32> {
        return vec3<f32>(
          caneLightSrgbToLinear(value.r),
          caneLightSrgbToLinear(value.g),
          caneLightSrgbToLinear(value.b)
        );
      }

      fn caneLightEncodeSrgb(value: vec3<f32>) -> vec3<f32> {
        return vec3<f32>(
          caneLightLinearToSrgb(value.r),
          caneLightLinearToSrgb(value.g),
          caneLightLinearToSrgb(value.b)
        );
      }
    `,
    end: /* wgsl */`
      let caneLightTextureLinear = (vCaneFlags & ${FLAG_TEXTURE_LINEAR}u) != 0u;
      let caneLightTexturePremultiplied = (vCaneFlags & ${FLAG_TEXTURE_PREMULTIPLIED}u) != 0u;
      let caneLightOutputStraight = (vCaneFlags & ${FLAG_OUTPUT_STRAIGHT}u) != 0u;
      let caneLightTextureAlpha = outColor.a;
      var caneLightTextureRgb = outColor.rgb;
      if (!caneLightTextureLinear) {
        caneLightTextureRgb = caneLightDecodeSrgb(caneLightTextureRgb);
      }
      if (caneLightTexturePremultiplied) {
        if (caneLightTextureAlpha > 0.000001) {
          caneLightTextureRgb /= caneLightTextureAlpha;
        } else {
          caneLightTextureRgb = vec3<f32>(0.0);
        }
      }
      var caneLightStraight = caneLightTextureRgb * caneLightDecodeSrgb(vLight.rgb);
      caneLightStraight = clamp(caneLightStraight, vec3<f32>(0.0), vec3<f32>(1.0));
      let caneLightOutputAlpha = clamp(caneLightTextureAlpha * vLight.a, 0.0, 1.0);
      let caneLightEncoded = caneLightEncodeSrgb(caneLightStraight);
      if (caneLightOutputStraight) {
        var caneLightGlobalStraight = vec3<f32>(0.0);
        if (vColor.a > 0.000001) {
          caneLightGlobalStraight = vColor.rgb / vColor.a;
        }
        finalColor = vec4<f32>(
          caneLightEncoded * caneLightGlobalStraight,
          caneLightOutputAlpha * vColor.a
        );
      } else {
        finalColor = vec4<f32>(
          caneLightEncoded * caneLightOutputAlpha,
          caneLightOutputAlpha
        ) * vColor;
      }
    `,
  },
};

const caneLightTintBitGl: HighShaderBit = {
  name: "cane-v1-light-tint-gl",
  vertex: {
    header: /* glsl */`
      in vec4 aLight;
      out vec4 vLight;
      out float vCaneFlags;
    `,
    main: /* glsl */`
      vLight = aLight;
      vCaneFlags = floor((aTextureIdAndRound.x + 0.5) / 2.0);
    `,
    end: /* glsl */`
      float caneLightRoundAndFlags = floor(aTextureIdAndRound.x + 0.5);
      if (mod(caneLightRoundAndFlags, 2.0) >= 1.0 && caneLightRoundAndFlags != 1.0) {
        gl_Position.xy = roundPixels(gl_Position.xy, uResolution);
      }
    `,
  },
  fragment: {
    header: /* glsl */`
      in vec4 vLight;
      in float vCaneFlags;

      float caneLightSrgbToLinear(float channel) {
        if (channel <= 0.04045) {
          return channel / 12.92;
        }
        return pow((channel + 0.055) / 1.055, 2.4);
      }

      float caneLightLinearToSrgb(float channel) {
        if (channel <= 0.0031308) {
          return channel * 12.92;
        }
        return 1.055 * pow(channel, 1.0 / 2.4) - 0.055;
      }

      vec3 caneLightDecodeSrgb(vec3 value) {
        return vec3(
          caneLightSrgbToLinear(value.r),
          caneLightSrgbToLinear(value.g),
          caneLightSrgbToLinear(value.b)
        );
      }

      vec3 caneLightEncodeSrgb(vec3 value) {
        return vec3(
          caneLightLinearToSrgb(value.r),
          caneLightLinearToSrgb(value.g),
          caneLightLinearToSrgb(value.b)
        );
      }

      bool caneLightFlag(float flags, float bit) {
        return mod(floor(flags / bit), 2.0) >= 1.0;
      }
    `,
    end: /* glsl */`
      float caneLightFlags = floor(vCaneFlags + 0.5);
      bool caneLightTextureLinear = caneLightFlag(caneLightFlags, ${FLAG_TEXTURE_LINEAR}.0);
      bool caneLightTexturePremultiplied = caneLightFlag(caneLightFlags, ${FLAG_TEXTURE_PREMULTIPLIED}.0);
      bool caneLightOutputStraight = caneLightFlag(caneLightFlags, ${FLAG_OUTPUT_STRAIGHT}.0);
      float caneLightTextureAlpha = outColor.a;
      vec3 caneLightTextureRgb = outColor.rgb;
      if (!caneLightTextureLinear) {
        caneLightTextureRgb = caneLightDecodeSrgb(caneLightTextureRgb);
      }
      if (caneLightTexturePremultiplied) {
        if (caneLightTextureAlpha > 0.000001) {
          caneLightTextureRgb /= caneLightTextureAlpha;
        } else {
          caneLightTextureRgb = vec3(0.0);
        }
      }
      vec3 caneLightStraight = caneLightTextureRgb * caneLightDecodeSrgb(vLight.rgb);
      caneLightStraight = clamp(caneLightStraight, vec3(0.0), vec3(1.0));
      float caneLightOutputAlpha = clamp(caneLightTextureAlpha * vLight.a, 0.0, 1.0);
      vec3 caneLightEncoded = caneLightEncodeSrgb(caneLightStraight);
      if (caneLightOutputStraight) {
        vec3 caneLightGlobalStraight = vColor.a > 0.000001 ? vColor.rgb / vColor.a : vec3(0.0);
        finalColor = vec4(
          caneLightEncoded * caneLightGlobalStraight,
          caneLightOutputAlpha * vColor.a
        );
      } else {
        finalColor = vec4(
          caneLightEncoded * caneLightOutputAlpha,
          caneLightOutputAlpha
        ) * vColor;
      }
    `,
  },
};

const caneTintBit: HighShaderBit = {
  name: "cane-v1-tint",
  vertex: {
    header: /* wgsl */`
      @in aLight: vec4<f32>;
      @in aDarkAndFlags: vec4<f32>;
      @out vLight: vec4<f32>;
      @out vDarkAndFlags: vec4<f32>;
    `,
    main: /* wgsl */`
      vLight = aLight;
      vDarkAndFlags = aDarkAndFlags;
    `,
  },
  fragment: {
    header: /* wgsl */`
      @in vLight: vec4<f32>;
      @in vDarkAndFlags: vec4<f32>;

      fn caneSrgbToLinear(channel: f32) -> f32 {
        if (channel <= 0.04045) {
          return channel / 12.92;
        }
        return pow((channel + 0.055) / 1.055, 2.4);
      }

      fn caneLinearToSrgb(channel: f32) -> f32 {
        if (channel <= 0.0031308) {
          return channel * 12.92;
        }
        return 1.055 * pow(channel, 1.0 / 2.4) - 0.055;
      }

      fn caneDecodeSrgb(value: vec3<f32>) -> vec3<f32> {
        return vec3<f32>(
          caneSrgbToLinear(value.r),
          caneSrgbToLinear(value.g),
          caneSrgbToLinear(value.b)
        );
      }

      fn caneEncodeSrgb(value: vec3<f32>) -> vec3<f32> {
        return vec3<f32>(
          caneLinearToSrgb(value.r),
          caneLinearToSrgb(value.g),
          caneLinearToSrgb(value.b)
        );
      }
    `,
    end: /* wgsl */`
      let caneFlags = u32(round(vDarkAndFlags.a * 255.0));
      let caneTwoColor = (caneFlags & ${FLAG_TWO_COLOR}u) != 0u;
      let caneTextureLinear = (caneFlags & ${FLAG_TEXTURE_LINEAR}u) != 0u;
      let caneTexturePremultiplied = (caneFlags & ${FLAG_TEXTURE_PREMULTIPLIED}u) != 0u;
      let caneOutputStraight = (caneFlags & ${FLAG_OUTPUT_STRAIGHT}u) != 0u;
      let caneTextureAlpha = outColor.a;
      var caneTextureRgb = outColor.rgb;
      if (!caneTextureLinear) {
        caneTextureRgb = caneDecodeSrgb(caneTextureRgb);
      }
      if (caneTexturePremultiplied) {
        if (caneTextureAlpha > 0.000001) {
          caneTextureRgb /= caneTextureAlpha;
        } else {
          caneTextureRgb = vec3<f32>(0.0);
        }
      }
      let caneLight = caneDecodeSrgb(vLight.rgb);
      let caneDark = caneDecodeSrgb(vDarkAndFlags.rgb);
      var caneStraight = caneTextureRgb * caneLight;
      if (caneTwoColor) {
        caneStraight = caneDark + (caneLight - caneDark) * caneTextureRgb;
      }
      caneStraight = clamp(caneStraight, vec3<f32>(0.0), vec3<f32>(1.0));
      let caneOutputAlpha = clamp(caneTextureAlpha * vLight.a, 0.0, 1.0);
      let caneEncoded = caneEncodeSrgb(caneStraight);
      if (caneOutputStraight) {
        var caneGlobalStraight = vec3<f32>(0.0);
        if (vColor.a > 0.000001) {
          caneGlobalStraight = vColor.rgb / vColor.a;
        }
        finalColor = vec4<f32>(caneEncoded * caneGlobalStraight, caneOutputAlpha * vColor.a);
      } else {
        finalColor = vec4<f32>(caneEncoded * caneOutputAlpha, caneOutputAlpha) * vColor;
      }
    `,
  },
};

const caneTintBitGl: HighShaderBit = {
  name: "cane-v1-tint-gl",
  vertex: {
    header: /* glsl */`
      in vec4 aLight;
      in vec4 aDarkAndFlags;
      out vec4 vLight;
      out vec4 vDarkAndFlags;
    `,
    main: /* glsl */`
      vLight = aLight;
      vDarkAndFlags = aDarkAndFlags;
    `,
  },
  fragment: {
    header: /* glsl */`
      in vec4 vLight;
      in vec4 vDarkAndFlags;

      float caneSrgbToLinear(float channel) {
        if (channel <= 0.04045) {
          return channel / 12.92;
        }
        return pow((channel + 0.055) / 1.055, 2.4);
      }

      float caneLinearToSrgb(float channel) {
        if (channel <= 0.0031308) {
          return channel * 12.92;
        }
        return 1.055 * pow(channel, 1.0 / 2.4) - 0.055;
      }

      vec3 caneDecodeSrgb(vec3 value) {
        return vec3(
          caneSrgbToLinear(value.r),
          caneSrgbToLinear(value.g),
          caneSrgbToLinear(value.b)
        );
      }

      vec3 caneEncodeSrgb(vec3 value) {
        return vec3(
          caneLinearToSrgb(value.r),
          caneLinearToSrgb(value.g),
          caneLinearToSrgb(value.b)
        );
      }

      bool caneFlag(float flags, float bit) {
        return mod(floor(flags / bit), 2.0) >= 1.0;
      }
    `,
    end: /* glsl */`
      float caneFlags = floor(vDarkAndFlags.a * 255.0 + 0.5);
      bool caneTwoColor = caneFlag(caneFlags, ${FLAG_TWO_COLOR}.0);
      bool caneTextureLinear = caneFlag(caneFlags, ${FLAG_TEXTURE_LINEAR}.0);
      bool caneTexturePremultiplied = caneFlag(caneFlags, ${FLAG_TEXTURE_PREMULTIPLIED}.0);
      bool caneOutputStraight = caneFlag(caneFlags, ${FLAG_OUTPUT_STRAIGHT}.0);
      float caneTextureAlpha = outColor.a;
      vec3 caneTextureRgb = outColor.rgb;
      if (!caneTextureLinear) {
        caneTextureRgb = caneDecodeSrgb(caneTextureRgb);
      }
      if (caneTexturePremultiplied) {
        if (caneTextureAlpha > 0.000001) {
          caneTextureRgb /= caneTextureAlpha;
        } else {
          caneTextureRgb = vec3(0.0);
        }
      }
      vec3 caneLight = caneDecodeSrgb(vLight.rgb);
      vec3 caneDark = caneDecodeSrgb(vDarkAndFlags.rgb);
      vec3 caneStraight = caneTextureRgb * caneLight;
      if (caneTwoColor) {
        caneStraight = caneDark + (caneLight - caneDark) * caneTextureRgb;
      }
      caneStraight = clamp(caneStraight, vec3(0.0), vec3(1.0));
      float caneOutputAlpha = clamp(caneTextureAlpha * vLight.a, 0.0, 1.0);
      vec3 caneEncoded = caneEncodeSrgb(caneStraight);
      if (caneOutputStraight) {
        vec3 caneGlobalStraight = vColor.a > 0.000001 ? vColor.rgb / vColor.a : vec3(0.0);
        finalColor = vec4(caneEncoded * caneGlobalStraight, caneOutputAlpha * vColor.a);
      } else {
        finalColor = vec4(caneEncoded * caneOutputAlpha, caneOutputAlpha) * vColor;
      }
    `,
  },
};
