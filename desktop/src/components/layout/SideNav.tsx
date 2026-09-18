import Icon from '../ui/Icon';
import { NAV_FOOTER, NAV_GROUPS, NAV_ALIAS, type ScreenId } from '../../lib/nav';
import type { IconId } from '../ui/IconSprite';

/**
 * 导航侧栏（222px）。
 * 分组 / 顺序 / 徽标位置严格对齐设计稿 `.side`。
 */
export default function SideNav({
  current,
  onNavigate,
  badges,
  version,
  disabled,
}: {
  current: ScreenId;
  onNavigate: (id: ScreenId) => void;
  /** 动态徽标。没有数据的项不传，就不渲染徽标。 */
  badges?: Partial<Record<ScreenId, { text: string; tone?: 'mut' | 'bad' }>>;
  version: string;
  /** 后端断开时整栏禁用（设计稿 12 屏的做法：40% 不透明度 + 不可点） */
  disabled?: boolean;
}) {
  // 子页（如 rules）高亮其所属的父级导航项
  const active = NAV_ALIAS[current] ?? current;

  const renderItem = (item: { id: ScreenId; label: string; icon: IconId }) => {
    const badge = badges?.[item.id];
    return (
      <button
        key={item.id}
        className={`ni ${active === item.id ? 'on' : ''} ${disabled ? 'dis' : ''}`}
        onClick={() => !disabled && onNavigate(item.id)}
        title={item.label}
      >
        <Icon name={item.icon} />
        {item.label}
        {badge && <span className={`bdg ${badge.tone === 'bad' ? 'bad' : ''}`}>{badge.text}</span>}
      </button>
    );
  };

  return (
    <aside className="side">
      <div className="brand">
        <span className="mk">
          <Icon name="i-shield" />
        </span>
        <div>
          <div className="nm">OpsAgent</div>
          <div className="vr">{version} · console</div>
        </div>
      </div>

      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="gl">{group.label}</div>
          {group.items.map(renderItem)}
        </div>
      ))}

      <div className="ft">{renderItem(NAV_FOOTER)}</div>
    </aside>
  );
}
