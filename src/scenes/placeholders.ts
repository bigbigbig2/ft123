/**
 * placeholders.ts — 占位场景
 *
 * 提供几个使用简单几何体的占位场景，用于开发阶段测试转场效果。
 * 正式上线后应替换为实际内容。
 */
import * as THREE from 'three';
import { ModelScene } from './ModelScene';

/**
 * 创建占位场景 1 — 蓝色旋转立方体
 */
export function createScene1(): ModelScene {
  const scene = new ModelScene({
    name: 'scene1',
    cameraPosition: [2.5, 1.6, 2.5],
    autoRotateSpeed: 0.3,
  });

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4a90e2,     // 蓝色
    metalness: 0.3,
    roughness: 0.4,
  });
  scene.addModel(new THREE.Mesh(geo, mat));

  return scene;
}

/**
 * 创建占位场景 2 — 灰蓝色旋转球体
 */
export function createScene2(): ModelScene {
  const scene = new ModelScene({
    name: 'scene2',
    cameraPosition: [0, 0.5, 3],
    autoRotateSpeed: 0.25,
  });

  const geo = new THREE.SphereGeometry(1, 64, 48);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x88aacc,     // 灰蓝色
    metalness: 0.1,
    roughness: 0.6,
  });
  scene.addModel(new THREE.Mesh(geo, mat));

  return scene;
}

/**
 * 创建占位场景 3 — 金色旋转环结（Torus Knot）
 */
export function createScene3(): ModelScene {
  const scene = new ModelScene({
    name: 'scene3',
    cameraPosition: [0, 1.2, 3.2],
    autoRotateSpeed: 0.4,
  });

  const geo = new THREE.TorusKnotGeometry(0.7, 0.24, 160, 24);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe2c48a,     // 金色
    metalness: 0.6,
    roughness: 0.35,
  });
  scene.addModel(new THREE.Mesh(geo, mat));

  return scene;
}
