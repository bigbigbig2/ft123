import { Pane } from 'tweakpane';
import type { Engine } from '../core/Engine';
import type { SharedBackdrop } from '../render/SharedBackdrop';
import type { TransitionRenderer } from '../runtime/TransitionRenderer';
import type { ChapterLayout } from '../scroll/chapterConfig';
import type { ScrollRig, ScrollRigState } from '../scroll/ScrollRig';
import type { TimelineDirector, TimelineFrame } from '../scroll/TimelineDirector';
import type { SceneBase } from '../scenes/SceneBase';

export interface DebugPanelOptions {
  engine: Engine;
  scroll: ScrollRig;
  director: TimelineDirector;
  transition: TransitionRenderer;
  backdrop: SharedBackdrop;
  sections: SceneBase[];
  chapters: ChapterLayout[];
}

export interface DebugPanel {
  update(frame: TimelineFrame, scrollState: ScrollRigState): void;
  destroy(): void;
}

function createContainer() {
  const container = document.createElement('div');
  container.className = 'ft-debug-panel';
  // 调试面板独立挂在 body 上，避免被业务 DOM 的布局和层级影响。
  Object.assign(container.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    width: '360px',
    maxHeight: 'calc(100vh - 24px)',
    overflow: 'auto',
    zIndex: '90',
  });
  document.body.appendChild(container);
  return container;
}

function shouldIgnoreToggle(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function getSceneDisplayName(sceneName: string, chapters: ChapterLayout[]) {
  return chapters.find((chapter) => chapter.sceneName === sceneName)?.label ?? sceneName;
}

export function createDebugPanel(opts: DebugPanelOptions): DebugPanel {
  const container = createContainer();
  const sceneLabels = new Map(opts.chapters.map((chapter) => [chapter.sceneName, chapter.label]));
  // Tweakpane 只负责调试 UI，实际状态仍然来自 ScrollRig / TimelineDirector。
  const pane = new Pane({
    title: 'FT 调试面板',
    container,
    expanded: true,
  });

  // Runtime 分组是只读监控区，用来确认滚动管线当前输出了什么。
  const runtime = {
    progress: 0,
    velocity: 0,
    rawVelocity: 0,
    direction: 0,
    activeChapter: '',
    currentScene: '',
    nextScene: '',
    localProgress: 0,
    mix: 0,
  };

  const runtimeFolder = pane.addFolder({ title: '运行状态', expanded: true });
  runtimeFolder.addBinding(runtime, 'progress', { readonly: true, label: '全局进度', format: (value) => value.toFixed(3) });
  runtimeFolder.addBinding(runtime, 'velocity', { readonly: true, label: '归一化速度', format: (value) => value.toFixed(3) });
  runtimeFolder.addBinding(runtime, 'rawVelocity', { readonly: true, label: '原始速度', format: (value) => value.toFixed(0) });
  runtimeFolder.addBinding(runtime, 'direction', { readonly: true, label: '方向' });
  runtimeFolder.addBinding(runtime, 'activeChapter', { readonly: true, label: '当前章节' });
  runtimeFolder.addBinding(runtime, 'currentScene', { readonly: true, label: '当前场景' });
  runtimeFolder.addBinding(runtime, 'nextScene', { readonly: true, label: '下一场景' });
  runtimeFolder.addBinding(runtime, 'localProgress', { readonly: true, label: '章节进度', format: (value) => value.toFixed(3) });
  runtimeFolder.addBinding(runtime, 'mix', { readonly: true, label: '转场混合', format: (value) => value.toFixed(3) });

  const actionsFolder = pane.addFolder({ title: '章节跳转', expanded: true });
  for (const chapter of opts.chapters) {
    actionsFolder
      .addButton({ title: `跳转到${chapter.label}` })
      // 跳转仍然走 ScrollRig 的统一入口，不直接操作 window.scrollTo。
      .on('click', () => opts.scroll.scrollToProgress(chapter.start, { duration: 0.55 }));
  }
  actionsFolder
    .addButton({ title: '跳转到结尾' })
    .on('click', () => opts.scroll.scrollToProgress(1, { duration: 0.55 }));

  // 这些参数影响滚轮手感，修改后直接回写到 ScrollRig。
  const scrollParams = opts.scroll.getDebugParams();
  const scrollFolder = pane.addFolder({ title: '滚动输入', expanded: false });
  scrollFolder
    .addBinding(scrollParams, 'wheelInputScale', { min: 0.2, max: 2.5, step: 0.01, label: '滚轮倍率' })
    .on('change', () => opts.scroll.applyDebugParams(scrollParams));
  scrollFolder
    .addBinding(scrollParams, 'wheelDeltaClamp', { min: 24, max: 420, step: 1, label: '滚轮裁剪' })
    .on('change', () => opts.scroll.applyDebugParams(scrollParams));

  const chapterFolder = pane.addFolder({ title: '章节配置', expanded: false });
  for (const chapter of opts.director.getChapters()) {
    const folder = chapterFolder.addFolder({ title: `${chapter.index}. ${chapter.label}`, expanded: false });
    // 起止点由章节权重计算出来，只读；转场窗口可以现场调参验证节奏。
    folder.addBinding(chapter, 'start', { readonly: true, label: '起点', format: (value) => value.toFixed(3) });
    folder.addBinding(chapter, 'end', { readonly: true, label: '终点', format: (value) => value.toFixed(3) });
    folder.addBinding(chapter, 'transitionStart', { min: 0, max: 0.98, step: 0.01, label: '转场开始' });
    folder.addBinding(chapter, 'transitionEnd', { min: 0.02, max: 1, step: 0.01, label: '转场结束' });
    folder.addBinding(chapter, 'preloadMargin', { min: 0, max: 0.5, step: 0.01, label: '预加载距离' });
  }

  // 合成 shader 参数集中放在 Transition 分组，避免散落在场景代码里。
  const transitionParams = opts.transition.getDebugParams();
  const transitionFolder = pane.addFolder({ title: '转场合成', expanded: false });
  transitionFolder
    .addBinding(transitionParams, 'chromaticStrength', { min: 0, max: 1.5, step: 0.01, label: '色散强度' })
    .on('change', (event) => opts.transition.setChromaticStrength(event.value));
  transitionFolder
    .addBinding(transitionParams, 'edgeSoftness', { min: 0.05, max: 3, step: 0.01, label: '边缘柔化' })
    .on('change', (event) => opts.transition.setEdgeSoftness(event.value));
  transitionFolder
    .addBinding(transitionParams, 'smearStrength', { min: 0, max: 2, step: 0.01, label: '拖影强度' })
    .on('change', (event) => opts.transition.setSmearStrength(event.value));
  transitionFolder
    .addBinding(transitionParams, 'smearLength', { min: 0, max: 0.35, step: 0.001, label: '拖影长度' })
    .on('change', (event) => opts.transition.setSmearLength(event.value));
  transitionFolder
    .addBinding(transitionParams, 'smearAngle', { min: -Math.PI, max: Math.PI, step: 0.01, label: '拖影角度' })
    .on('change', (event) => opts.transition.setSmearAngle(event.value));
  transitionFolder
    .addBinding(transitionParams, 'fogWashStrength', { min: 0, max: 1.5, step: 0.01, label: '雾化强度' })
    .on('change', (event) => opts.transition.setFogWashStrength(event.value));
  transitionFolder
    .addBinding(transitionParams, 'sceneBRevealStart', { min: 0, max: 0.95, step: 0.01, label: 'B 场景显现' })
    .on('change', (event) => opts.transition.setSceneBRevealStart(event.value));

  // 背景参数当前是调试态默认值；变更时会立即同步到 SharedBackdrop。
  const backdropParams = {
    color1: '#aebdcd',
    color2: '#edf4f8',
    dotStrength: 1,
    blueNoiseStrength: 0.018,
    centerGlowStrength: 0.5,
  };
  const backdropFolder = pane.addFolder({ title: '共享背景', expanded: false });
  backdropFolder
    .addBinding(backdropParams, 'color1', { label: '颜色 1' })
    .on('change', (event) => opts.backdrop.setColor1(event.value));
  backdropFolder
    .addBinding(backdropParams, 'color2', { label: '颜色 2' })
    .on('change', (event) => opts.backdrop.setColor2(event.value));
  backdropFolder
    .addBinding(backdropParams, 'dotStrength', { min: 0, max: 2, step: 0.01, label: '点阵强度' })
    .on('change', (event) => opts.backdrop.setDotStrength(event.value));
  backdropFolder
    .addBinding(backdropParams, 'blueNoiseStrength', { min: 0, max: 0.15, step: 0.001, label: '蓝噪声' })
    .on('change', (event) => opts.backdrop.setBlueNoiseStrength(event.value));
  backdropFolder
    .addBinding(backdropParams, 'centerGlowStrength', { min: 0, max: 1, step: 0.01, label: '中心光' })
    .on('change', (event) => opts.backdrop.setCenterGlowStrength(event.value));

  const engineFolder = pane.addFolder({ title: '渲染引擎', expanded: false });
  engineFolder.addButton({ title: '暂停' }).on('click', () => opts.engine.stop());
  engineFolder.addButton({ title: '继续' }).on('click', () => opts.engine.start());

  // Scenes 分组只展示场景元信息，避免调试面板越权修改场景内部状态。
  const sceneFolder = pane.addFolder({ title: '场景信息', expanded: false });
  for (const scene of opts.sections) {
    const info = {
      name: sceneLabels.get(scene.name) ?? scene.name,
      id: scene.name,
      camera: scene.camera.type,
    };
    const folder = sceneFolder.addFolder({ title: info.name, expanded: false });
    folder.addBinding(info, 'name', { readonly: true, label: '显示名' });
    folder.addBinding(info, 'id', { readonly: true, label: '场景标识' });
    folder.addBinding(info, 'camera', { readonly: true, label: '相机类型' });
  }

  let visible = true;
  const setVisible = (next: boolean) => {
    visible = next;
    container.style.display = visible ? 'block' : 'none';
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (shouldIgnoreToggle(event)) return;
    if (event.key.toLowerCase() === 'd') {
      // 输入框聚焦时不响应快捷键，避免调参数时误关面板。
      setVisible(!visible);
    }
  };
  window.addEventListener('keydown', onKeydown);

  let lastRefresh = 0;

  return {
    update(frame, scrollState) {
      runtime.progress = scrollState.progress;
      runtime.velocity = scrollState.velocity;
      runtime.rawVelocity = scrollState.rawVelocity;
      runtime.direction = scrollState.direction;
      runtime.activeChapter = frame.activeChapter.label;
      runtime.currentScene = getSceneDisplayName(frame.current.name, opts.chapters);
      runtime.nextScene = getSceneDisplayName(frame.next.name, opts.chapters);
      runtime.localProgress = frame.localProgress;
      runtime.mix = frame.mix;

      const now = performance.now();
      // 面板刷新节流到约 10fps，调试 UI 不应该抢占主渲染循环。
      if (visible && now - lastRefresh > 100) {
        pane.refresh();
        lastRefresh = now;
      }
    },
    destroy() {
      window.removeEventListener('keydown', onKeydown);
      pane.dispose();
      container.remove();
    },
  };
}
