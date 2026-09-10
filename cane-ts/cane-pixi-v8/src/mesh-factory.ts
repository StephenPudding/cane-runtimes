import type { RuntimeRenderAttachmentV1 } from "@cane-runtime/core";
import { RuntimeErrorV1 } from "@cane-runtime/core";
import { Mesh, type Container, type MeshGeometry, type Texture } from "pixi.js";

export interface CanePixiMeshContextV1 {
  readonly attachment: RuntimeRenderAttachmentV1;
  readonly geometry: MeshGeometry;
  readonly texture: Texture;
}

export interface CanePixiMeshFactoryV1 {
  validate(context: CanePixiMeshContextV1): void;
  create(context: CanePixiMeshContextV1): Container;
  /** Updates material state without replacing the renderable or geometry. */
  update(renderable: Container, context: CanePixiMeshContextV1): void;
  destroy(renderable: Container, geometry: MeshGeometry): void;
}

export class BasicPixiMeshFactory implements CanePixiMeshFactoryV1 {
  validate({ attachment, texture }: CanePixiMeshContextV1): void {
    if (attachment.twoColor) {
      unsupportedMaterial(attachment, "two-color tint requires a Cane Pixi shader");
    }
    if (attachment.texture.colorSpace !== "srgb") {
      unsupportedMaterial(attachment, "linear texture input requires a Cane Pixi shader");
    }
    if (attachment.texture.alphaMode !== "straight") {
      unsupportedMaterial(attachment, "premultiplied texture input requires a Cane Pixi shader");
    }
    if (texture.source.alphaMode !== "premultiply-alpha-on-upload") {
      unsupportedMaterial(
        attachment,
        "Pixi's built-in Mesh shader requires a PixiTextureStore using the 'pixiBasic' pipeline",
      );
    }
  }

  create(context: CanePixiMeshContextV1): Mesh {
    const mesh = new Mesh({
      geometry: context.geometry,
      texture: context.texture,
      roundPixels: false,
      label: `cane:${context.attachment.slotId}:${context.attachment.attachmentId}`,
    });
    this.update(mesh, context);
    mesh.eventMode = "none";
    return mesh;
  }

  update(renderable: Container, context: CanePixiMeshContextV1): void {
    if (!(renderable instanceof Mesh)) {
      throw new RuntimeErrorV1("invalidState", "pixiApply", "BasicPixiMeshFactory received a non-Mesh renderable.");
    }
    const mesh = renderable;
    mesh.texture = context.texture;
    const [red, green, blue] = context.attachment.tint.lightRgb;
    mesh.tint = (red << 16) | (green << 8) | blue;
    mesh.alpha = context.attachment.tint.alpha;
    mesh.blendMode = context.attachment.blendMode;
  }

  destroy(renderable: Container, geometry: MeshGeometry): void {
    renderable.destroy();
    geometry.destroy(true);
  }
}

function unsupportedMaterial(attachment: RuntimeRenderAttachmentV1, reason: string): never {
  throw new RuntimeErrorV1("unsupportedFeature", "pixiApply", reason, {
    field: "material",
    entityId: attachment.attachmentId,
  });
}
