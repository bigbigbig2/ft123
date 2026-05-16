import * as THREE from 'three';

/**
 * EngineView 接口：定义了一个“可被 Engine 驱动的视图”。
 * 
 * 核心设计：
 * TransitionRenderer (转场渲染器) 实现了此接口。
 * Engine 并不直接操作具体的 Scene 或 Camera，而是操作一个 EngineView。
 * 这解耦了底层的渲染循环与高层的业务场景。
 */
export interface EngineView {
  // 每帧更新逻辑（如：物体旋转、物理计算）
  update(delta: number, elapsed: number): void;
  // 执行 WebGL 渲染
  render(renderer: THREE.WebGLRenderer): void;
  // 响应窗口尺寸变化
  setSize?(width: number, height: number, pixelRatio: number): void;
}

// TickCallback 定义：每帧执行的回调函数类型
export type TickCallback = (delta: number, elapsed: number, time: number) => void;

/**
 * Engine 类：整个 WebGL 渲染架构的最底层。
 *
 * 核心职责：
 * 1. 实例并维护唯一的 WebGLRenderer。
 * 2. 维护高精度时钟 (THREE.Clock) 和渲染循环 (requestAnimationFrame)。
 * 3. 驱动当前主视图 (view) 的 update 和 render。
 * 4. 统一处理窗口尺寸变化 (Resize) 和 像素比 (DPR)。
 * 5. 提供钩子 (onTick) 允许外部模块（如滚动系统）同步执行逻辑。
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
    // 限制最大像素比为 2，以平衡高清显示与 GPU 性能开销
    this.pixelRatio = Math.min(window.devicePixelRatio, 2);

    // 初始化渲染器
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,         // 开启抗锯齿
      alpha: false,            // 视口背景不透明，提高性能
      powerPreference: 'high-performance', // 请求高性能 GPU
    });
    
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; // 采用标准 sRGB 色彩空间
    this.renderer.toneMapping = THREE.NoToneMapping;      // 默认不开启色调映射，由后处理控制
    this.renderer.setClearColor(0x0b0d12, 1);              // 设置底色

    this.canvas = this.renderer.domElement;
    container.appendChild(this.canvas);

    // 绑定并监听 Resize 事件
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  }

  /** 
   * 设置当前主视图
   * TransitionRenderer 将作为主视图接管后续的 update/render 流程。
   */
  setView(view: EngineView) {
    this.view = view;
    const { width, height } = this.getSize();
    view.setSize?.(width, height, this.pixelRatio);
  }

  /** 
   * 注册每帧回调
   * 通常用于：滚动控制器状态更新、GUI 实时监测等需要与渲染帧同步的任务。
   */
  onTick(cb: TickCallback) {
    this.tickCallbacks.push(cb);
    return () => {
      const idx = this.tickCallbacks.indexOf(cb);
      if (idx >= 0) this.tickCallbacks.splice(idx, 1);
    };
  }

  /** 开启渲染循环 */
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.loop();
  }

  /** 停止渲染循环 */
  stop() {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * 核心渲染循环
   */
  private loop = () => {
    if (!this.running) return;
    
    // 计算上一帧到这一帧的时间间隔 (delta) 和总运行时间 (elapsed)
    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();
    const time = performance.now();

    // 1. 先跑所有外部注册的回调
    for (const cb of this.tickCallbacks) cb(delta, elapsed, time);

    // 2. 驱动当前视图的更新与渲染
    if (this.view) {
      this.view.update(delta, elapsed);
      this.view.render(this.renderer);
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  /** 获取容器当前尺寸 */
  private getSize() {
    const rect = this.container.getBoundingClientRect();
    return {
      width: Math.max(1, Math.floor(rect.width || window.innerWidth)),
      height: Math.max(1, Math.floor(rect.height || window.innerHeight)),
    };
  }

  /** 响应尺寸变化：更新渲染器和视图的大小 */
  private handleResize() {
    const { width, height } = this.getSize();
    // false 表示由 CSS 控制 Canvas 的物理尺寸，renderer 仅调整 Buffer 尺寸
    this.renderer.setSize(width, height, false);
    this.view?.setSize?.(width, height, this.pixelRatio);
  }

  /** 销毁引擎实例，释放内存 */
  dispose() {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
