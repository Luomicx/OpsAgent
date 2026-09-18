import type { ReactNode, CSSProperties } from 'react';
import Icon from './Icon';
import type { IconId } from './IconSprite';

/* ============================================================
   通用 Figma 级原语。全部对应设计稿里的一个类，样式在 CSS 里，这里只做结构。
   ============================================================ */

export type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'ac' | 'pur' | 'mut';

/** 按钮：`pri` 主 / `gh` 幽灵 / `dg` 危险 / 默认 */
export function Btn({
  children,
  icon,
  tone = 'default',
  sm,
  disabled,
  onClick,
  style,
  title,
}: {
  children?: ReactNode;
  icon?: IconId;
  tone?: 'default' | 'pri' | 'gh' | 'dg';
  sm?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  title?: string;
}) {
  const cls = ['btn', tone !== 'default' ? tone : '', sm ? 'sm' : ''].filter(Boolean).join(' ');
  return (
    <button className={cls} disabled={disabled} onClick={onClick} style={style} title={title}>
      {icon && <Icon name={icon} size="s" />}
      {children}
    </button>
  );
}

/** 语义标签 */
export function Tag({
  children,
  tone = 'mut',
  mono,
  style,
}: {
  children: ReactNode;
  tone?: Tone;
  mono?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span className={`tag ${tone} ${mono ? 'mono' : ''}`} style={style}>
      {children}
    </span>
  );
}

/** 可点击胶囊 */
export function Chip({
  children,
  on,
  onClick,
  style,
}: {
  children: ReactNode;
  on?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <button className={`chip ${on ? 'on' : ''}`} onClick={onClick} style={style} type="button">
      {children}
    </button>
  );
}

/** 状态点 */
export function Dot({ tone = 'mut', breathe }: { tone?: 'ok' | 'bad' | 'warn' | 'mut'; breathe?: boolean }) {
  return <span className={`dot ${tone} ${breathe ? 'breathe' : ''}`} />;
}

/** 进度条 */
export function Bar({ pct, tone, style }: { pct: number; tone?: 'ok' | 'bad' | 'warn'; style?: CSSProperties }) {
  return (
    <span className="bar" style={style}>
      <i className={tone} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

/** KPI 卡 */
export function Kpi({
  label,
  value,
  unit,
  valueColor,
  foot,
  compact,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  valueColor?: string;
  foot?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="kpi" style={compact ? { padding: '12px 14px' } : undefined}>
      <div className="k">{label}</div>
      <div className="v" style={{ ...(compact ? { fontSize: 22 } : {}), color: valueColor }}>
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {foot && <div className="d">{foot}</div>}
    </div>
  );
}

/** 表单字段：无边框圆角背景（设计要求） */
export function Field({
  label,
  hint,
  value,
  placeholder,
  onChange,
  mono,
  multiline,
  rows,
}: {
  label: string;
  hint?: string;
  value?: string;
  placeholder?: string;
  onChange?: (v: string) => void;
  mono?: boolean;
  multiline?: boolean;
  rows?: number;
}) {
  const editable = typeof onChange === 'function';
  return (
    <div className="fld">
      <label>{label}</label>
      <div
        className={`inp ${!value && placeholder ? 'ph' : ''}`}
        style={multiline ? { height: 'auto', minHeight: rows ? rows * 20 + 16 : 56, alignItems: 'flex-start', padding: '9px 12px' } : undefined}
      >
        {editable ? (
          multiline ? (
            <textarea
              className={mono ? 'mono' : undefined}
              value={value ?? ''}
              placeholder={placeholder}
              onChange={(e) => onChange!(e.target.value)}
              style={{ fontSize: 12.5 }}
            />
          ) : (
            <input
              className={mono ? 'mono' : undefined}
              value={value ?? ''}
              placeholder={placeholder}
              onChange={(e) => onChange!(e.target.value)}
            />
          )
        ) : (
          <span className={mono ? 'mono' : undefined} style={{ fontSize: 12.5, color: value ? undefined : 'var(--t4)' }}>
            {value || placeholder}
          </span>
        )}
      </div>
      {hint && <span style={{ fontSize: 10.5, color: 'var(--t4)' }}>{hint}</span>}
    </div>
  );
}

/** 代码块 */
export function Code({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="code" style={style}>
      {children}
    </div>
  );
}

/** 空状态 */
export function Empty({
  icon,
  title,
  desc,
  actions,
}: {
  icon: IconId;
  title: string;
  desc?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="or">
        <Icon name={icon} size="xl" />
      </div>
      <h3>{title}</h3>
      {desc && <p>{desc}</p>}
      {actions && <div style={{ display: 'flex', gap: 10, marginTop: 26 }}>{actions}</div>}
    </div>
  );
}

/** 占位数据包裹（重构计划 §0 硬约束：示意值必须可辨识） */
export function Placeholder({
  children,
  enabled = true,
  style,
}: {
  children: ReactNode;
  enabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span className={enabled ? 'ph-mark' : undefined} style={style}>
      {children}
    </span>
  );
}
