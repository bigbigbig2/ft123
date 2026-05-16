import * as THREE from 'three';

/** 遍历模型里的所有 Mesh，并关闭视锥裁剪，避免大模型入场时被错误裁掉。 */
export function forEachMesh(root: THREE.Object3D, cb: (mesh: THREE.Mesh) => void) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    cb(mesh);
  });
}

/** 批量替换 GLTF 材质，并释放旧材质，避免调试阶段重复加载导致显存泄漏。 */
export function setMaterial(root: THREE.Object3D, material: THREE.Material) {
  forEachMesh(root, (mesh) => {
    const oldMaterial = mesh.material;
    mesh.material = material;
    if (Array.isArray(oldMaterial)) oldMaterial.forEach((mat) => mat.dispose());
    else oldMaterial?.dispose?.();
  });
}

/** 将文字模型统一成发光感更强的透明基础材质，并返回可继续调透明度的材质列表。 */
export function normalizeText(root: THREE.Object3D) {
  const materials: THREE.MeshBasicMaterial[] = [];

  forEachMesh(root, (mesh) => {
    const oldMaterial = mesh.material;
    const material = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    mesh.material = material;
    materials.push(material);

    if (Array.isArray(oldMaterial)) oldMaterial.forEach((mat) => mat.dispose());
    else oldMaterial?.dispose?.();
  });

  return materials;
}

/** 把模型包围盒中心移动到目标点，用于快速校准 GLTF 模型原点。 */
export function moveBoxCenterTo(root: THREE.Object3D, target: THREE.Vector3) {
  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.add(target.sub(center));
}
