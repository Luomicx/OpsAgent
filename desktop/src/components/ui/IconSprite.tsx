/**
 * 图标精灵。**自动生成，请勿手改**。
 *
 * 单一事实来源是设计稿 design/console-ui.html；
 * 要改图标请先改设计稿，再执行：
 *
 *     python desktop/scripts/extract_icons.py
 *
 * 用法：<Icon name="i-shield" /> —— 内部走 <use href="#id">，
 * 描边与填充由 CSS 的 .ic 控制，颜色继承 currentColor。
 */
const SPRITE = `
    <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 2.8 4.6 6v6c0 4.4 3 7.9 7.4 9.2 4.4-1.3 7.4-4.8 7.4-9.2V6z"/><path d="M9.3 12.2l1.9 1.9 3.6-3.8"/></symbol>
    <symbol id="i-terminal" viewBox="0 0 24 24"><rect x="3" y="4.4" width="18" height="15.2" rx="2.6"/><path d="M7.4 9.6l2.6 2.5-2.6 2.5M12.8 15h4"/></symbol>
    <symbol id="i-pulse" viewBox="0 0 24 24"><path d="M2.6 12.4h4l2-5.4 3.4 10.6 2.4-7 1.8 3.4h5.2"/></symbol>
    <symbol id="i-database" viewBox="0 0 24 24"><ellipse cx="12" cy="6.4" rx="7.4" ry="3.2"/><path d="M4.6 6.4v11.2c0 1.8 3.3 3.2 7.4 3.2s7.4-1.4 7.4-3.2V6.4"/><path d="M4.6 12c0 1.8 3.3 3.2 7.4 3.2s7.4-1.4 7.4-3.2"/></symbol>
    <symbol id="i-server" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="6.4" rx="2.2"/><rect x="3" y="13.6" width="18" height="6.4" rx="2.2"/><path d="M7 7.2h.01M7 16.8h.01"/></symbol>
    <symbol id="i-plug" viewBox="0 0 24 24"><path d="M9 3v5.4M15 3v5.4"/><path d="M6.4 8.4h11.2v2.8a5.6 5.6 0 0 1-11.2 0z"/><path d="M12 16.8V21"/></symbol>
    <symbol id="i-chip" viewBox="0 0 24 24"><rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.4"/><path d="M9.6 3v3.4M14.4 3v3.4M9.6 17.6V21M14.4 17.6V21M3 9.6h3.4M3 14.4h3.4M17.6 9.6H21M17.6 14.4H21"/></symbol>
    <symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 7.6h6.4M15 7.6h5M4 16.4h4.4M13 16.4h7"/><circle cx="12.6" cy="7.6" r="2.4"/><circle cx="10.6" cy="16.4" r="2.4"/></symbol>
    <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.4"/><path d="M15.8 15.8 20 20"/></symbol>
    <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5.4v13.2M5.4 12h13.2"/></symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.6 10 17.6 19 6.8"/></symbol>
    <symbol id="i-x" viewBox="0 0 24 24"><path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8"/></symbol>
    <symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 3.4 21 19.4H3z"/><path d="M12 9.6v4.2M12 17v.2"/></symbol>
    <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.6M12 7.7v.2"/></symbol>
    <symbol id="i-sparkle" viewBox="0 0 24 24"><path d="M11 2.6l1.9 5.3 5.3 1.9-5.3 1.9L11 17l-1.9-5.3L3.8 9.8l5.3-1.9z"/><path d="M18.4 15.6l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></symbol>
    <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.2V12l3.2 2"/></symbol>
    <symbol id="i-play" viewBox="0 0 24 24"><path d="M8.6 5.4v13.2L19 12z"/></symbol>
    <symbol id="i-pause" viewBox="0 0 24 24"><path d="M9.4 5.4v13.2M14.6 5.4v13.2"/></symbol>
    <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4.4v11.4"/><path d="M7.6 11.4 12 15.8l4.4-4.4"/><path d="M4.6 18.4v.6a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-.6"/></symbol>
    <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.7-6"/><path d="M20.2 4.4v4.4h-4.4"/></symbol>
    <symbol id="i-chev-l" viewBox="0 0 24 24"><path d="M14.6 5.4 8 12l6.6 6.6"/></symbol>
    <symbol id="i-chev-r" viewBox="0 0 24 24"><path d="M9.4 5.4 16 12l-6.6 6.6"/></symbol>
    <symbol id="i-chev-d" viewBox="0 0 24 24"><path d="M5.4 9.4 12 16l6.6-6.6"/></symbol>
    <symbol id="i-more" viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/></symbol>
    <symbol id="i-filter" viewBox="0 0 24 24"><path d="M3.4 5.6h17.2l-6.6 7.6v5.6l-4-2.2v-3.4z"/></symbol>
    <symbol id="i-eye" viewBox="0 0 24 24"><path d="M1.8 12S5.4 5.8 12 5.8 22.2 12 22.2 12 18.6 18.2 12 18.2 1.8 12 1.8 12z"/><circle cx="12" cy="12" r="3.2"/></symbol>
    <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.4" y="8.4" width="11.2" height="11.2" rx="2.4"/><path d="M15.6 5.6a2.4 2.4 0 0 0-2.4-2.4H6.8a2.4 2.4 0 0 0-2.4 2.4v6.4a2.4 2.4 0 0 0 2.4 2.4"/></symbol>
    <symbol id="i-edit" viewBox="0 0 24 24"><path d="M4.6 19.4l.9-4.3L15.6 5a2.2 2.2 0 0 1 3.2 3.2L8.9 18.5z"/><path d="M4.6 19.4l4.3-.9"/></symbol>
    <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4.6 6.8h14.8M9.4 6.8V4.6h5.2v2.2"/><path d="M6.6 6.8l.9 12a1.8 1.8 0 0 0 1.8 1.6h5.4a1.8 1.8 0 0 0 1.8-1.6l.9-12"/></symbol>
    <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.4" width="14" height="9.6" rx="2.8"/><path d="M8.4 10.4V8a3.6 3.6 0 0 1 7.2 0v2.4"/></symbol>
    <symbol id="i-key" viewBox="0 0 24 24"><circle cx="7.6" cy="15.4" r="3.6"/><path d="M10.2 12.8 19.4 3.6M16.6 6.4l2.4 2.4M14 9l2.4 2.4"/></symbol>
    <symbol id="i-layers" viewBox="0 0 24 24"><path d="M12 2.8 2.8 7.6 12 12.4l9.2-4.8z"/><path d="M2.8 12.4 12 17.2l9.2-4.8"/><path d="M2.8 16.8 12 21.6l9.2-4.8"/></symbol>
    <symbol id="i-box" viewBox="0 0 24 24"><path d="M12 2.8 3.2 7.2v9.6L12 21.2l8.8-4.4V7.2z"/><path d="M3.2 7.2 12 11.6l8.8-4.4M12 11.6v9.6"/></symbol>
    <symbol id="i-branch" viewBox="0 0 24 24"><circle cx="6.4" cy="6.4" r="2.6"/><circle cx="6.4" cy="17.6" r="2.6"/><circle cx="17.6" cy="12" r="2.6"/><path d="M6.4 9v6M9 6.4h3a2.6 2.6 0 0 1 2.6 2.6v1"/></symbol>
    <symbol id="i-zap" viewBox="0 0 24 24"><path d="M13.4 2.6 4.6 13.4h6.6l-.6 8 8.8-10.8h-6.6z"/></symbol>
    <symbol id="i-file" viewBox="0 0 24 24"><path d="M13.6 3.4H7a2.4 2.4 0 0 0-2.4 2.4v12.4A2.4 2.4 0 0 0 7 20.6h10a2.4 2.4 0 0 0 2.4-2.4V9.2z"/><path d="M13.6 3.4v5.8h5.8M8.4 13.4h7.2M8.4 16.8h4.8"/></symbol>
    <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3.6" y="3.6" width="6.8" height="6.8" rx="2"/><rect x="13.6" y="3.6" width="6.8" height="6.8" rx="2"/><rect x="3.6" y="13.6" width="6.8" height="6.8" rx="2"/><rect x="13.6" y="13.6" width="6.8" height="6.8" rx="2"/></symbol>
    <symbol id="i-list" viewBox="0 0 24 24"><path d="M8.4 6.4h11.2M8.4 12h11.2M8.4 17.6h11.2M4.4 6.4h.01M4.4 12h.01M4.4 17.6h.01"/></symbol>
    <symbol id="i-bell" viewBox="0 0 24 24"><path d="M6.6 16.6V11a5.4 5.4 0 0 1 10.8 0v5.6"/><path d="M4.8 16.6h14.4"/><path d="M10 19.4a2 2 0 0 0 4 0"/></symbol>
    <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8.4" r="3.9"/><path d="M4.8 20c1-3.6 3.8-5.5 7.2-5.5s6.2 1.9 7.2 5.5"/></symbol>
    <symbol id="i-plug-off" viewBox="0 0 24 24"><path d="M9 3v5.4M13.6 3.4v4.4"/><path d="M6.4 8.4h8.2v2.8c0 .6-.07 1.2-.2 1.74"/><path d="M7.2 15.4a5.6 5.6 0 0 0 7.6 1.4M12 16.8V21"/><path d="M3.4 3.4 20.6 20.6"/></symbol>
    <symbol id="i-arrow-up" viewBox="0 0 24 24"><path d="M12 19.4V4.6M6 10.6 12 4.6l6 6"/></symbol>
    <symbol id="i-arrow-dn" viewBox="0 0 24 24"><path d="M12 4.6v14.8M6 13.4 12 19.4l6-6"/></symbol>
    <symbol id="i-terminal-2" viewBox="0 0 24 24"><path d="M4.4 6.4 9 12l-4.6 5.6"/><path d="M12.4 17.6h7.2"/></symbol>
    <symbol id="i-activity" viewBox="0 0 24 24"><path d="M3.4 17.6V6.4M9.4 17.6V10M15.4 17.6V13.6M21 17.6V8.4"/></symbol>
    <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8"/><path d="M12 3.6c2.2 2.4 3.3 5.3 3.3 8.4s-1.1 6-3.3 8.4c-2.2-2.4-3.3-5.3-3.3-8.4s1.1-6 3.3-8.4z"/></symbol>
`;

export const ICON_IDS = ['i-shield', 'i-terminal', 'i-pulse', 'i-database', 'i-server', 'i-plug', 'i-chip', 'i-sliders', 'i-search', 'i-plus', 'i-check', 'i-x', 'i-alert', 'i-info', 'i-sparkle', 'i-clock', 'i-play', 'i-pause', 'i-download', 'i-refresh', 'i-chev-l', 'i-chev-r', 'i-chev-d', 'i-more', 'i-filter', 'i-eye', 'i-copy', 'i-edit', 'i-trash', 'i-lock', 'i-key', 'i-layers', 'i-box', 'i-branch', 'i-zap', 'i-file', 'i-grid', 'i-list', 'i-bell', 'i-user', 'i-plug-off', 'i-arrow-up', 'i-arrow-dn', 'i-terminal-2', 'i-activity', 'i-globe'] as const;

export type IconId =
  | 'i-shield'
  | 'i-terminal'
  | 'i-pulse'
  | 'i-database'
  | 'i-server'
  | 'i-plug'
  | 'i-chip'
  | 'i-sliders'
  | 'i-search'
  | 'i-plus'
  | 'i-check'
  | 'i-x'
  | 'i-alert'
  | 'i-info'
  | 'i-sparkle'
  | 'i-clock'
  | 'i-play'
  | 'i-pause'
  | 'i-download'
  | 'i-refresh'
  | 'i-chev-l'
  | 'i-chev-r'
  | 'i-chev-d'
  | 'i-more'
  | 'i-filter'
  | 'i-eye'
  | 'i-copy'
  | 'i-edit'
  | 'i-trash'
  | 'i-lock'
  | 'i-key'
  | 'i-layers'
  | 'i-box'
  | 'i-branch'
  | 'i-zap'
  | 'i-file'
  | 'i-grid'
  | 'i-list'
  | 'i-bell'
  | 'i-user'
  | 'i-plug-off'
  | 'i-arrow-up'
  | 'i-arrow-dn'
  | 'i-terminal-2'
  | 'i-activity'
  | 'i-globe';

export default function IconSprite() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: SPRITE }}
    />
  );
}
