import {
  CANE_LAYA_VERTEX_FLOAT_STRIDE_V1,
  CANE_LAYA_VERTEX_STRIDE_BYTES_V1,
  type CaneLayaGeometryUploadV1,
} from "./geometry.js";

/**
 * Exact LayaAir 3.4.1 low-level Mesh2D bridge.
 *
 * These are public types/properties in the 3.4.1 declaration, but they expose
 * device buffers directly. Keeping every call here makes the version lock
 * auditable and prevents engine details from leaking into the Runtime API.
 */
export function createCaneLayaMeshV1(upload: CaneLayaGeometryUploadV1): Laya.Mesh2D {
  const vertexDeclaration = new Laya.VertexDeclaration(CANE_LAYA_VERTEX_STRIDE_BYTES_V1, [
    new Laya.VertexElement(0, Laya.VertexElementFormat.Vector3, Laya.VertexMesh.MESH_POSITION0),
    new Laya.VertexElement(12, Laya.VertexElementFormat.Vector2, Laya.VertexMesh.MESH_TEXTURECOORDINATE0),
    new Laya.VertexElement(20, Laya.VertexElementFormat.Vector4, Laya.VertexMesh.MESH_COLOR0),
    new Laya.VertexElement(36, Laya.VertexElementFormat.Vector4, Laya.VertexMesh.MESH_CUSTOME0),
  ]);
  if (vertexDeclaration.vertexStride !== CANE_LAYA_VERTEX_FLOAT_STRIDE_V1 * 4) {
    throw new Error("Cane LayaAir vertex declaration stride mismatch.");
  }
  const mesh = Laya.Mesh2D.createMesh2DByPrimitive(
    [upload.vertexData],
    [vertexDeclaration],
    upload.indices,
    upload.indexFormat === "uint32" ? Laya.IndexFormat.UInt32 : Laya.IndexFormat.UInt16,
    [{ start: 0, length: upload.indexCount }],
    false,
  );
  // The upload view may contain one unused Uint16 pad index for WebGPU.
  // Preserve the logical count while SubMesh keeps the exact draw range.
  mesh.indexBuffer.indexCount = upload.indexCount;
  return mesh;
}

export function uploadCaneLayaMeshV1(
  mesh: Laya.Mesh2D,
  upload: CaneLayaGeometryUploadV1,
): void {
  const vertexBuffer = mesh.vertexBuffers[0];
  if (vertexBuffer === undefined) throw new Error("Cane LayaAir Mesh2D has no vertex buffer.");
  vertexBuffer.setData(
    upload.vertexData.buffer,
    0,
    upload.vertexData.byteOffset,
    upload.vertexUploadBytes,
  );
  mesh.indexBuffer.setData(
    upload.indices.buffer as ArrayBuffer,
    0,
    upload.indices.byteOffset,
    upload.indexUploadBytes,
  );
  const subMesh = mesh.getSubMesh(0);
  subMesh.clearRenderParams();
  subMesh.setDrawElemenParams(upload.indexCount, 0);
}
