import * as THREE from 'three';

/**
 * 一个"可被 Engine 驱动的视图"。
 * TransitionRenderer 就是实现该接口的主视图。
 */
export interface EngineView {
  update(delta: number, elapsed: number): void;
  render(renderer: THREE.WebGLRenderer): void;
  setSize?(width: number, height: number, pixelRatio: number): void;
}

export type TickCallback = (delta: number, elapsed: number, time: number) => void;

/**
 * Engine 是整个渲染的最底层：
 * - 拥有唯一的 WebGLRenderer
 * - 维护 THREE.Clock
 * - 每帧驱动 view.update -> view.render
 * - 处理 resize
 *
 * 它不关心"画哪些场景"，只负责把当前 view 跑起来。
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private clock = new THREE.Clock();
  private view: EngineView | null = null;
  private tickCallbacks: TickCallback[] = [];
  private rafId: number | null = null;
  private running = false;
  private container: HTMLElement;
  private pixelRatio: number;

  constructor(container: HTMLElement) {
    this.container = container;
    this.pixelRatio = Math.min(window.devicePixelRatio, 2);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x0b0d12, 1);

    this.canvas = this.renderer.domElement;
    container.appendChild(this.canvas);

    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  }

  /** 设置当前主视图（通常是 TransitionRenderer） */
  setView(view: EngineView) {
    this.view = view;
    const { width, height } = this.getSize();
    view.setSize?.(width, height, this.pixelRatio);
  }

  /** 注册每帧回调（滚动驱动、外部动画等挂这里） */
  onTick(cb: TickCallback) {
    this.tickCallbacks.push(cb);
    return () => {
      const idx = this.tickCallbacks.indexOf(cb);
      if (idx >= 0) this.tickCallbacks.splice(idx, 1);
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private loop = () => {
    if (!this.running) return;
    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();
    const time = performance.now();

    // 先跑所有外挂回调（Lenis raf、GSAP 等）
    for (const cb of this.tickCallbacks) cb(delta, elapsed, time);

    // 驱动主视图
    if (this.view) {
      this.view.update(delta, elapsed);
      this.view.render(this.renderer);
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private getSize() {
    const rect = this.container.getBoundingClientRect();
    return {
      width: Math.max(1, Math.floor(rect.width || window.innerWidth)),
      height: Math.max(1, Math.floor(rect.height || window.innerHeight)),
    };
  }

  private handleResize() {
    const { width, height } = this.getSize();
    this.renderer.setSize(width, height, false);
    this.view?.setSize?.(width, height, this.pixelRatio);
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
