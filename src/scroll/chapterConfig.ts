export interface ChapterConfig {
  id: string;
  sceneName: string;
  label: string;
  /** 章节在总滚动长度中的相对占比。值越大，该章节停留距离越长。 */
  weight: number;
  /** 当前章节内部进度达到该值后，开始和下一章节混合。 */
  transitionStart: number;
  /** 当前章节内部进度达到该值后，下一章节完全接管。 */
  transitionEnd: number;
  /** 转场开始前提前激活下一场景，用于预热模型、视频等资源。 */
  preloadMargin?: number;
}

export interface ChapterLayout extends ChapterConfig {
  index: number;
  /** 章节在全局滚动进度中的起点，范围 0..1。 */
  start: number;
  /** 章节在全局滚动进度中的终点，范围 0..1。 */
  end: number;
}

/** 用一段真实页面高度承载虚拟章节时间轴，数值越大滚动越细腻。 */
export const SCROLL_STAGE_HEIGHT_VH = 520;

/** 当前站点章节顺序。新增场景时，优先从这里配置滚动节奏。 */
export const CHAPTERS: ChapterConfig[] = [
  {
    id: 'intro',
    sceneName: 'intro-video',
    label: '开场视频',
    weight: 1,
    transitionStart: 0.58,
    transitionEnd: 0.86,
    preloadMargin: 0.12,
  },
  {
    id: 'earth',
    sceneName: 'earth',
    label: '地球',
    weight: 1.15,
    transitionStart: 0.66,
    transitionEnd: 0.9,
    preloadMargin: 0.12,
  },
  {
    id: 'scene-1',
    sceneName: 'scene1',
    label: '场景 1',
    weight: 0.9,// 章节相对占比，影响滚动停留时间
    transitionStart: 0.64,
    transitionEnd: 0.88,
    preloadMargin: 0.12,
  },
  {
    id: 'scene-2',
    sceneName: 'scene2',
    label: '场景 2',
    weight: 0.9,
    transitionStart: 1,
    transitionEnd: 1,
    preloadMargin: 0,
  },
];

export function createChapterLayout(chapters: ChapterConfig[]): ChapterLayout[] {
  const totalWeight = chapters.reduce((sum, chapter) => sum + Math.max(chapter.weight, 0.0001), 0);
  let cursor = 0;

  // 将相对权重转换成全局进度区间，TimelineDirector 只消费这个布局结果。
  return chapters.map((chapter, index) => {
    const start = cursor;
    const span = Math.max(chapter.weight, 0.0001) / totalWeight;
    const end = index === chapters.length - 1 ? 1 : start + span;
    cursor = end;

    return {
      ...chapter,
      index,
      start,
      end,
    };
  });
}

export function getChapterSnapPoints(layout: ChapterLayout[]) {
  // ScrollTrigger 的 snap 点使用全局进度，因此直接取每个章节起点和结尾 1。
  const points = layout.map((chapter) => chapter.start);
  points.push(1);
  return Array.from(new Set(points.map((point) => Number(point.toFixed(5))))).sort((a, b) => a - b);
}
