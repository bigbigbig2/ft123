/**
 * loaders.ts — 资源加载工具
 *
 * 封装 Three.js 的纹理加载器和 GLTF 加载器，
 * 返回 Promise 以便配合 async/await 使用。
 * 支持常规纹理（jpg/png）和 KTX2 压缩纹理。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/** 纹理加载选项 */
export interface TextureLoadOptions {
  colorSpace?: THREE.ColorSpace;       // 色彩空间（如 SRGBColorSpace）
  minFilter?: THREE.TextureFilter;     // 缩小滤波（默认 LinearFilter）
  magFilter?: THREE.TextureFilter;     // 放大滤波（默认 LinearFilter）
  repeat?: [number, number];           // UV 重复次数 [u, v]
  wrap?: THREE.Wrapping;               // 环绕模式（默认 RepeatWrapping）
}

/**
 * 配置纹理的通用参数
 * 统一设置环绕、滤波、mipmap 等属性
 */
function configureTexture(texture: THREE.Texture, opts: TextureLoadOptions = {}) {
  const wrap = opts.wrap ?? THREE.RepeatWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.minFilter = opts.minFilter ?? THREE.LinearFilter;
  texture.magFilter = opts.magFilter ?? THREE.LinearFilter;
  texture.generateMipmaps = false;  // 不生成 mipmap（运行时纹理通常不需要）

  if (opts.repeat) {
    texture.repeat.set(opts.repeat[0], opts.repeat[1]);
  }

  if (opts.colorSpace) {
    texture.colorSpace = opts.colorSpace;
  }

  texture.needsUpdate = true;
  return texture;
}

/**
 * 加载常规纹理（jpg / png 等）
 * @param url - 纹理文件路径
 * @param opts - 纹理配置选项
 */
export function loadTexture(url: string, opts: TextureLoadOptions = {}): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (texture) => resolve(configureTexture(texture, opts)),
      undefined,
      (err) => reject(err),
    );
  });
}

/**
 * 加载 KTX2 压缩纹理
 *
 * KTX2 是 GPU 压缩纹理容器格式，需要 Basis Universal 转码器。
 * 转码器路径指向 /decoders/basis/。
 *
 * @param url - KTX2 文件路径
 * @param renderer - WebGL 渲染器（用于检测 GPU 支持的压缩格式）
 * @param opts - 纹理配置选项
 */
export function loadKTX2Texture(
  url: string,
  renderer: THREE.WebGLRenderer,
  opts: TextureLoadOptions = {},
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new KTX2Loader()
      .setTranscoderPath('/decoders/basis/')  // Basis 转码器 WASM 路径
      .detectSupport(renderer);               // 检测当前 GPU 支持的格式

    loader.load(
      url,
      (texture) => {
        loader.dispose();  // 加载完成后释放转码器资源
        resolve(configureTexture(texture, opts));
      },
      undefined,
      (err) => {
        loader.dispose();
        reject(err);
      },
    );
  });
}

/**
 * 加载 GLTF/GLB 3D 模型
 * @param url - GLTF 文件路径
 */
export function loadGLTF(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(url, resolve, undefined, reject);
  });
}
