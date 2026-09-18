import type { ReactNode } from 'react';
import Icon from '../ui/Icon';
import type { IconId } from '../ui/IconSprite';

/**
 * 页头（`.ph`）：标题 + 副标题 + 右侧操作区。
 * 内边距 18/24/14 与 gap 14 由 CSS 的 `.ph` 提供，这里不重复设值。
 */
export function PageHeader({
  title,
  sub,
  actions,
  leading,
}: {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
  /** 标题左侧的额外元素（如返回按钮） */
  leading?: ReactNode;
}) {
  return (
    <div className="ph">
      {leading}
      <div>
        <h2>{title}</h2>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <span className="sp" />
      {actions}
    </div>
  );
}

/** 主内容区（`.bd`）：可滚动，子元素不收缩 */
export function Body({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="bd" style={style}>
      {children}
    </div>
  );
}

/** 右侧栏（`.rail`，296px） */
export function Rail({ children }: { children: ReactNode }) {
  return <aside className="rail">{children}</aside>;
}

/** 卡片 */
export function Card({
  pad,
  hover,
  className = '',
  style,
  children,
}: {
  pad?: boolean;
  hover?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={`card ${hover ? 'hv' : ''} ${pad ? 'pad' : ''} ${className}`} style={style}>
      {children}
    </div>
  );
}

/** 卡片头：标题 + 右侧插槽 */
export function CardHead({
  title,
  icon,
  iconTone,
  right,
  children,
}: {
  title?: ReactNode;
  icon?: IconId;
  iconTone?: 'ok' | 'bad' | 'warn' | 'info' | 'ac' | 'pur';
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="hd">
      {icon && (
        <span
          className="ico"
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            display: 'grid',
            placeItems: 'center',
            color: `var(--${iconTone ?? 'ac'})`,
            background: `var(--${iconTone ?? 'ac'}-bg)`,
          }}
        >
          <Icon name={icon} size="s" />
        </span>
      )}
      {title && <h3>{title}</h3>}
      <span className="sp" />
      {right ?? children}
    </div>
  );
}

/** 分组小标签（`.lbl`） */
export function Label({ children, block }: { children: ReactNode; block?: boolean }) {
  return (
    <div className="lbl" style={block ? { margin: '2px 0 8px 3px' } : undefined}>
      {children}
    </div>
  );
}

/** 提示条 */
export function Banner({
  tone,
  icon,
  children,
  style,
}: {
  tone: 'ok' | 'bad' | 'warn' | 'info';
  icon?: IconId;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`bnr ${tone}`} style={style}>
      {icon && <Icon name={icon} size="s" />}
      <span>{children}</span>
    </div>
  );
}
