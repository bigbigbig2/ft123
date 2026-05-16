import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

export interface TextureLoadOptions {
  colorSpace?: THREE.ColorSpace;
  minFilter?: THREE.MinificationTextureFilter;
  magFilter?: THREE.MagnificationTextureFilter;
  repeat?: [number, number];
  wrap?: THREE.Wrapping;
}

function configureTexture(texture: THREE.Texture, opts: TextureLoadOptions = {}) {
  const wrap = opts.wrap ?? THREE.RepeatWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.minFilter = opts.minFilter ?? THREE.LinearFilter;
  texture.magFilter = opts.magFilter ?? THREE.LinearFilter;
  texture.generateMipmaps = false;

  if (opts.repeat) {
    texture.repeat.set(opts.repeat[0], opts.repeat[1]);
  }

  if (opts.colorSpace) {
    texture.colorSpace = opts.colorSpace;
  }

  texture.needsUpdate = true;
  return texture;
}

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

export function loadKTX2Texture(
  url: string,
  renderer: THREE.WebGLRenderer,
  opts: TextureLoadOptions = {},
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new KTX2Loader()
      .setTranscoderPath('/decoders/basis/')
      .detectSupport(renderer);

    loader.load(
      url,
      (texture) => {
        loader.dispose();
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

export function loadGLTF(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(url, resolve, undefined, reject);
  });
}
