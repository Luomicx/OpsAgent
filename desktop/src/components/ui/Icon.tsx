import type { IconId } from './IconSprite';

type Size = 's' | 'l' | 'xl' | undefined;

/**
 * 图标。描边/填充由 CSS 的 `.ic` 控制，颜色继承 currentColor。
 *
 * 图标定义来自 `<IconSprite>`（由设计稿自动生成）——
 * 这里只负责渲染 `<use>` 引用，不持有任何路径数据。
 */
export default function Icon({ name, size }: { name: IconId; size?: Size }) {
  return (
    <svg className={size ? `ic ${size}` : 'ic'} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}
