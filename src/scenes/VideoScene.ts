/**
 * VideoScene.ts - 视频场景
 *
 * 将 HTML5 video 渲染为全屏 Three.js 场景，支持 cover/contain 填充模式。
 */
import * as THREE from 'three';
import type { SceneBase, SceneScrollState, SceneTransitionState } from './SceneBase';

/** 构造选项 */
export interface VideoSceneOptions {
  src: string;
  name?: string;
  fit?: 'contain' | 'cover';
  muted?: boolean;
  loop?: boolean;
  segments?: VideoSceneSegment[];
}

export interface VideoSceneSegment {
  id: string;
  start: number;
  end: number;
  endGuard?: number;
  mode: 'once' | 'loop';
  next: 'auto' | 'scroll' | 'finish' | 'loop2' | 'loop4';
}

export interface VideoSceneDebugData {
  status: {
    currentSegment: string;
    currentIndex: number;
    currentTime: number;
    duration: number;
    waitingForScroll: boolean;
    playingReverseClip: boolean;
    finished: boolean;
    active: boolean;
  };
  segments: VideoSceneSegment[];
}

/**
 * VideoScene - 全屏视频场景
 * 使用 ShaderMaterial 通过 UV 变换实现 cover/contain 裁切。
 */
export class VideoScene implements SceneBase {
  readonly name: string;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly video: HTMLVideoElement;

  private videoTexture: THREE.VideoTexture;
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private fit: 'contain' | 'cover';
  private videoAspect = 16 / 9;
  private viewportAspect = 16 / 9;
  private backgroundDistance = 1450;
  private segments: VideoSceneSegment[];
  private currentSegmentIndex = 0;
  private finished = false;
  private active = false;
  private hasMetadata = false;
  private debugData: VideoSceneDebugData = {
    status: {
      currentSegment: '',
      currentIndex: 0,
      currentTime: 0,
      duration: 0,
      waitingForScroll: false,
      playingReverseClip: false,
      finished: false,
      active: false,
    },
    segments: [],
  };
  private wheelAccumulator = 0;
  private readonly wheelAdvanceThreshold = 280;
  private readonly reverseSegmentEndGuard = 1 / 30;
  private readonly finishSegmentEndGuard = 4 / 30;
  private wheelGestureHandler = (event: WheelEvent) => this.handleWheelGesture(event);

  constructor(opts: VideoSceneOptions) {
    this.name = opts.name ?? 'video';
    this.fit = opts.fit ?? 'cover';
    this.segments = opts.segments ?? [];
    this.debugData.segments = this.segments;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2200);

    const video = document.createElement('video');
    video.src = opts.src;
    video.loop = this.segments.length > 0 ? false : opts.loop ?? true;
    video.muted = opts.muted ?? true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.style.display = 'none';

    video.addEventListener('loadedmetadata', () => {
      this.hasMetadata = true;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        this.videoAspect = video.videoWidth / video.videoHeight;
        this.updateUvTransform();
      }
      if (this.segments.length > 0) this.seekToSegment(this.currentSegmentIndex);
    });
    this.video = video;

    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.magFilter = THREE.LinearFilter;

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

    const markReady = () => {
      this.material.uniforms.uReady.value = 1;
    };
    const markUnavailable = () => {
      this.material.uniforms.uReady.value = 0;
      console.warn(`[FT] Video unavailable: ${opts.src}`);
    };
    video.addEventListener('loadeddata', markReady);
    video.addEventListener('canplay', markReady);
    video.addEventListener('error', markUnavailable);
    video.addEventListener('ended', () => this.handleSegmentEnd());
    window.addEventListener('wheel', this.wheelGestureHandler, { passive: false, capture: true });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.scene.add(this.mesh);
    this.updateVideoPlaneTransform();
  }

  setActive(active: boolean) {
    this.active = active;
    if (active && !this.finished) this.video.play().catch(() => {});
    else this.video.pause();
  }

  setProgress(_progress: number) {}

  setTransitionState(_state: SceneTransitionState) {}

  setScrollState(_state: SceneScrollState) {
    this.updateVideoPlaneTransform();
  }

  update(_delta: number, _elapsed: number) {
    this.updateSegmentPlayback(_delta);
    this.updateVideoPlaneTransform();
  }

  isFinished() {
    return this.finished || this.segments.length === 0;
  }

  getCurrentSegment() {
    return this.segments[this.currentSegmentIndex] ?? null;
  }

  getVideoDebugData() {
    this.updateVideoDebugData();
    return this.debugData;
  }

  applyVideoDebug() {
    for (const segment of this.segments) {
      if (segment.end <= segment.start) segment.end = segment.start + 1 / 30;
    }

    const segment = this.segments[this.currentSegmentIndex];
    if (!segment) return;

    if (this.video.currentTime < segment.start || this.video.currentTime >= segment.end) {
      this.video.currentTime = segment.start;
    }
  }

  restartVideoSequence() {
    this.seekToSegment(0);
    if (this.active) this.video.play().catch(() => {});
  }

  advanceVideoSegment() {
    if (this.segments.length === 0) return;
    if (this.currentSegmentIndex >= this.segments.length - 1) {
      this.finished = true;
      this.video.pause();
      return;
    }
    this.seekToSegment(this.currentSegmentIndex + 1);
    if (this.active) this.video.play().catch(() => {});
  }

  jumpToVideoSegment(index: number) {
    this.seekToSegment(index);
    if (this.active) this.video.play().catch(() => {});
  }

  setSize(width: number, height: number) {
    this.viewportAspect = width / Math.max(height, 1);
    this.camera.aspect = this.viewportAspect;
    this.camera.updateProjectionMatrix();
    this.updateUvTransform();
    this.updateVideoPlaneTransform();
  }

  private updateUvTransform() {
    const videoAspect = this.videoAspect;
    const viewAspect = this.viewportAspect;
    const scale = this.material.uniforms.uUvScale.value as THREE.Vector2;

    if (this.fit === 'cover') {
      if (viewAspect > videoAspect) scale.set(1, videoAspect / viewAspect);
      else scale.set(viewAspect / videoAspect, 1);
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

  private updateSegmentPlayback(_delta: number) {
    if (this.segments.length === 0 || this.finished || !this.hasMetadata) return;

    const segment = this.segments[this.currentSegmentIndex];
    if (!segment) return;

    if (this.video.currentTime < segment.start - 0.08) {
      this.video.currentTime = segment.start;
      return;
    }

    if (this.video.currentTime >= this.getSegmentPlaybackEnd(segment)) this.handleSegmentEnd();
  }

  private getSegmentPlaybackEnd(segment: VideoSceneSegment) {
    const guardedEnd = (guard: number) => Math.max(segment.start, segment.end - Math.max(0, guard));

    if (typeof segment.endGuard === 'number') {
      return guardedEnd(segment.endGuard);
    }

    if (segment.next === 'finish') {
      return guardedEnd(this.finishSegmentEndGuard);
    }

    if (segment.next === 'loop2' || segment.next === 'loop4') {
      return guardedEnd(this.reverseSegmentEndGuard);
    }

    return segment.end;
  }

  private handleSegmentEnd() {
    if (this.segments.length === 0 || this.finished) return;

    const segment = this.segments[this.currentSegmentIndex];
    if (!segment) return;

    if (segment.mode === 'loop') {
      this.video.currentTime = segment.start;
      if (this.active) this.video.play().catch(() => {});
      return;
    }

    if (segment.next === 'auto') {
      this.seekToSegment(this.currentSegmentIndex + 1);
      if (this.active) this.video.play().catch(() => {});
      return;
    }

    if (segment.next === 'finish') {
      this.finished = true;
      this.video.pause();
      return;
    }

    if (segment.next === 'loop2') {
      this.seekToSegment(1);
      if (this.active) this.video.play().catch(() => {});
      return;
    }

    if (segment.next === 'loop4') {
      this.seekToSegment(3);
      if (this.active) this.video.play().catch(() => {});
    }
  }

  private handleWheelGesture(event: WheelEvent) {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('.ft-debug-panel')) return;
    if (!this.active || this.segments.length === 0) return;

    const deltaY = event.deltaY;
    const currentIndex = this.currentSegmentIndex;

    if (this.finished) {
      if (deltaY >= 0) return;
      this.consumeWheelEvent(event);
      this.accumulateWheel(-deltaY, () => this.seekToSegment(6));
      return;
    }

    this.consumeWheelEvent(event);

    if (currentIndex === 1) {
      if (deltaY > 0) this.accumulateWheel(deltaY, () => this.seekToSegment(2));
      else this.decayWheelAccumulator();
      return;
    }

    if (currentIndex === 3) {
      if (deltaY > 0) {
        this.accumulateWheel(deltaY, () => this.seekToSegment(4));
      } else if (deltaY < 0) {
        this.accumulateWheel(-deltaY, () => this.seekToSegment(5));
      }
      return;
    }

    this.decayWheelAccumulator();
  }

  private consumeWheelEvent(event: WheelEvent) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  private accumulateWheel(delta: number, onThreshold: () => void) {
    this.wheelAccumulator += Math.min(Math.abs(delta), 120);
    if (this.wheelAccumulator < this.wheelAdvanceThreshold) return;

    this.wheelAccumulator = 0;
    onThreshold();
    if (this.active && !this.finished) this.video.play().catch(() => {});
  }

  private decayWheelAccumulator() {
    this.wheelAccumulator = Math.max(0, this.wheelAccumulator - 24);
  }

  private seekToSegment(index: number) {
    const segmentCount = this.segments.length;
    if (segmentCount === 0) return;

    const nextIndex = THREE.MathUtils.clamp(index, 0, segmentCount - 1);
    const segment = this.segments[nextIndex];
    if (!segment) return;

    this.currentSegmentIndex = nextIndex;
    this.finished = false;
    this.wheelAccumulator = 0;
    if (!this.hasMetadata) return;
    this.video.currentTime = segment.start;
  }

  private updateVideoDebugData() {
    const segment = this.segments[this.currentSegmentIndex];
    this.debugData.status.currentSegment = segment ? `${this.currentSegmentIndex + 1}. ${segment.id}` : '';
    this.debugData.status.currentIndex = this.currentSegmentIndex + 1;
    this.debugData.status.currentTime = this.video.currentTime || 0;
    this.debugData.status.duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
    this.debugData.status.waitingForScroll = !!segment && segment.next === 'scroll';
    this.debugData.status.playingReverseClip = segment?.next === 'loop2' || segment?.next === 'loop4';
    this.debugData.status.finished = this.finished;
    this.debugData.status.active = this.active;
  }

  dispose() {
    window.removeEventListener('wheel', this.wheelGestureHandler, { capture: true });
    this.video.pause();
    this.video.src = '';
    this.video.load();
    this.videoTexture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

export function isVideoDebugScene(scene: SceneBase): scene is VideoScene {
  return scene instanceof VideoScene;
}
