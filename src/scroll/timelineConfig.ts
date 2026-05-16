/**
 * 显式滚动时间轴配置。
 *
 * 这里把“场景停留”和“场景转场”拆成两种独立段：
 * - scene：某个场景自己的内容进度，从 0 推到 1。
 * - transition：两个场景之间的过渡进度，从 A 混到 B。
 *
 * 这样 A -> B 的转场滚动距离可以单独配置，不再占用 A 或 B 的场景进度。
 */

export type TimelineSegmentType = 'scene' | 'transition';

interface TimelineSegmentBase {
  id: string;       // 时间轴段唯一标识
  label: string;    // 调试面板展示名
  duration: number; // 相对滚动长度。值越大，这一段滚动距离越长。
}

export interface TimelineSceneSegmentConfig extends TimelineSegmentBase {
  type: 'scene';
  sceneName: string; // 对应 SceneBase.name
}

export interface TimelineTransitionSegmentConfig extends TimelineSegmentBase {
  type: 'transition';
  from: string; // 离开的场景名
  to: string;   // 进入的场景名
}

export type TimelineSegmentConfig = TimelineSceneSegmentConfig | TimelineTransitionSegmentConfig;

interface TimelineSegmentLayoutBase {
  index: number;
  /** 当前段在全局滚动进度中的起点，范围 0..1。 */
  start: number;
  /** 当前段在全局滚动进度中的终点，范围 0..1。 */
  end: number;
}

export type TimelineSceneSegmentLayout = TimelineSceneSegmentConfig & TimelineSegmentLayoutBase;
export type TimelineTransitionSegmentLayout = TimelineTransitionSegmentConfig & TimelineSegmentLayoutBase;
export type TimelineSegmentLayout = TimelineSceneSegmentLayout | TimelineTransitionSegmentLayout;

/**
 * 虚拟滚动舞台高度。
 * 它只决定整条时间轴有多少真实滚动距离，不直接决定每段比例。
 */
export const SCROLL_STAGE_HEIGHT_VH = 620;

/**
 * 当前站点的主时间轴。
 * 后续新增内容时，优先在这里添加 scene 段和 transition 段。
 */
export const TIMELINE_SEGMENTS: TimelineSegmentConfig[] = [
  {
    type: 'scene',
    id: 'intro',
    sceneName: 'intro-video',
    label: '开场视频',
    duration: 0.78,
  },
  {
    type: 'transition',
    id: 'intro-to-earth',
    from: 'intro-video',
    to: 'earth',
    label: '开场视频 -> 地球',
    duration: 0.34,
  },
  {
    type: 'scene',
    id: 'earth',
    sceneName: 'earth',
    label: '地球',
    duration: 1.18,
  },
  {
    type: 'transition',
    id: 'earth-to-scene-1',
    from: 'earth',
    to: 'scene1',
    label: '地球 -> 场景 1',
    duration: 0.3,
  },
  {
    type: 'scene',
    id: 'scene-1',
    sceneName: 'scene1',
    label: '场景 1',
    duration: 0.9,
  },
  {
    type: 'transition',
    id: 'scene-1-to-scene-2',
    from: 'scene1',
    to: 'scene2',
    label: '场景 1 -> 场景 2',
    duration: 0.28,
  },
  {
    type: 'scene',
    id: 'scene-2',
    sceneName: 'scene2',
    label: '场景 2',
    duration: 0.95,
  },
];

/** 将相对 duration 转成全局 0..1 区间。 */
export function createTimelineLayout(segments: TimelineSegmentConfig[]): TimelineSegmentLayout[] {
  const totalDuration = segments.reduce((sum, segment) => sum + Math.max(segment.duration, 0.0001), 0);
  let cursor = 0;

  return segments.map((segment, index) => {
    const start = cursor;
    const span = Math.max(segment.duration, 0.0001) / totalDuration;
    const end = index === segments.length - 1 ? 1 : start + span;
    cursor = end;

    return {
      ...segment,
      index,
      start,
      end,
    };
  });
}

/** 类型收窄：判断当前段是否为场景段。 */
export function isSceneSegment(segment: TimelineSegmentLayout): segment is TimelineSceneSegmentLayout {
  return segment.type === 'scene';
}

/** 类型收窄：判断当前段是否为转场段。 */
export function isTransitionSegment(segment: TimelineSegmentLayout): segment is TimelineTransitionSegmentLayout {
  return segment.type === 'transition';
}

/** 调试跳转和吸附通常只落在场景段起点，而不是转场段中间。 */
export function getTimelineSnapPoints(layout: TimelineSegmentLayout[]) {
  const points = layout
    .filter(isSceneSegment)
    .map((segment) => segment.start);
  points.push(1);

  return Array.from(new Set(points.map((point) => Number(point.toFixed(5))))).sort((a, b) => a - b);
}

/** 获取所有场景段，用于调试面板生成“跳转到场景”按钮。 */
export function getSceneSegments(layout: TimelineSegmentLayout[]) {
  return layout.filter(isSceneSegment);
}

/** 建立 sceneName -> 中文展示名的映射。 */
export function getSceneLabelMap(layout: TimelineSegmentLayout[]) {
  return new Map(
    getSceneSegments(layout).map((segment) => [segment.sceneName, segment.label]),
  );
}
