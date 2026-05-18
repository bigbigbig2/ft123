/**
 * VideoScene.ts — 视频场景
 *
 * 将 HTML5 video 渲染为全屏 Three.js 场景，支持 cover/contain 填充模式。
 */
import * as THREE from 'three';
import type { SceneBase, SceneScrollState, SceneTransitionState } from './SceneBase';
import {
  CloudSpriteTransitionLayer,
  getDefaultCloudSpriteDebugParams,
  type CloudSpriteDebugParams,
  type CloudSpriteTransitionAssets,
} from '../runtime/CloudSpriteTransitionLayer';

/** 构造选项 */
export interface VideoSceneOptions {
  src: string;                // 视频路径
  name?: string;              // 场景名称
  fit?: 'contain' | 'cover';  // 填充模式（默认 cover）
  muted?: boolean;            // 静音（默认 true）
  loop?: boolean;             // 循环（默认 true）
  cloudAssets?: CloudSpriteTransitionAssets;
}

/**
 * VideoScene — 全屏视频场景
 * 使用 ShaderMaterial 通过 UV 变换实现 cover/contain 裁剪
 */
export class VideoScene implements SceneBase {
  readonly name: string;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** video 元素，暴露以便外部解锁自动播放 */
  readonly video: HTMLVideoElement;

  private videoTexture: THREE.VideoTexture;
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private cloudLayer: CloudSpriteTransitionLayer | null;
  private fit: 'contain' | 'cover';
  private videoAspect = 16 / 9;     // 视频原始宽高比
  private viewportAspect = 16 / 9;  // 画布宽高比
  private cloudProgress = 0;
  private backgroundDistance = 1450;

  constructor(opts: VideoSceneOptions) {
    this.name = opts.name ?? 'video';
    this.fit = opts.fit ?? 'cover';
    this.cloudLayer = opts.cloudAssets ? new CloudSpriteTransitionLayer(opts.cloudAssets) : null;
    this.scene = this.cloudLayer?.scene ?? new THREE.Scene();
    this.camera = this.cloudLayer?.camera ?? new THREE.PerspectiveCamera(42, 1, 0.1, 2200);

    // 创建隐藏的 video 元素
    const video = document.createElement('video');
    video.src = opts.src;
    video.loop = opts.loop ?? true;
    video.muted = opts.muted ?? true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.style.display = 'none';

    // 元数据就绪后获取真实宽高比
    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        this.videoAspect = video.videoWidth / video.videoHeight;
        this.updateUvTransform();
      }
    });
    this.video = video;

    // 创建视频纹理
    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.magFilter = THREE.LinearFilter;

    // 自定义着色器：UV 缩放实现 cover/contain，uReady 控制就绪前 discard
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tMap: { value: this.videoTexture },
        uUvScale: { value: new THREE.Vector2(1, 1) },
        uUvOffset: { value: new THREE.Vector2(0, 0) },
        uReady: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap;
        uniform vec2 uUvScale;
        uniform vec2 uUvOffset;
        uniform float uReady;
        varying vec2 vUv;
        void main() {
          if (uReady < 0.5) { discard; }
          vec2 uv = (vUv - 0.5) * uUvScale + 0.5 + uUvOffset;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            discard; return;
          }
          gl_FragColor = texture2D(tMap, uv);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });

    // 视频就绪/失败回调
    const markReady = () => { this.material.uniforms.uReady.value = 1; };
    const markUnavailable = () => {
      this.material.uniforms.uReady.value = 0;
      console.warn(`[FT] Video unavailable: ${opts.src}`);
    };
    video.addEventListener('loadeddata', markReady);
    video.addEventListener('canplay', markReady);
    video.addEventListener('error', markUnavailable);

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.scene.add(this.mesh);
    this.cloudLayer?.setProgress(0);
    this.updateVideoPlaneTransform();
  }

  /** 激活时播放视频，停用时暂停 */
  setActive(active: boolean) {
    if (active) { this.video.play().catch(() => {}); }
    else { this.video.pause(); }
  }

  setProgress(_progress: number) {}
  setTransitionState(_state: SceneTransitionState) {}
  setScrollState(state: SceneScrollState) {
    this.cloudProgress = state.transitionProgress;
    this.cloudLayer?.setProgress(this.cloudProgress);
    this.updateVideoPlaneTransform();
  }

  update(delta: number, elapsed: number) {
    this.cloudLayer?.update(delta, elapsed);
    this.updateVideoPlaneTransform();
  }

  /** 画布尺寸变化时重新计算 UV 变换 */
  setSize(width: number, height: number) {
    this.viewportAspect = width / Math.max(height, 1);
    this.camera.aspect = this.viewportAspect;
    this.camera.updateProjectionMatrix();
    this.cloudLayer?.setSize(width, height);
    this.updateUvTransform();
    this.updateVideoPlaneTransform();
  }

  /** 根据 cover/contain 模式计算 UV 缩放 */
  private updateUvTransform() {
    const videoAspect = this.videoAspect;
    const viewAspect = this.viewportAspect;
    const scale = this.material.uniforms.uUvScale.value as THREE.Vector2;

    if (this.fit === 'cover') {
      if (viewAspect > videoAspect) { scale.set(1, videoAspect / viewAspect); }
      else { scale.set(viewAspect / videoAspect, 1); }
    } else if (viewAspect > videoAspect) {
      scale.set(viewAspect / videoAspect, 1);
    } else {
      scale.set(1, videoAspect / viewAspect);
    }
  }

  private updateVideoPlaneTransform() {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.mesh.position.copy(this.camera.position).addScaledVector(direction, this.backgroundDistance);
    this.mesh.quaternion.copy(this.camera.quaternion);

    const height = 2 * this.backgroundDistance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5));
    const width = height * this.camera.aspect;
    this.mesh.scale.set(width, height, 1);
  }

  getCloudDebugParams(): CloudSpriteDebugParams {
    return this.cloudLayer?.getDebugParams() ?? getDefaultCloudSpriteDebugParams();
  }

  applyCloudDebugParams(params: CloudSpriteDebugParams) {
    this.cloudLayer?.applyDebugParams(params);
  }

  /** 释放视频和 GPU 资源 */
  dispose() {
    this.video.pause();
    this.video.src = '';
    this.video.load();
    this.videoTexture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.cloudLayer?.dispose();
  }
}
