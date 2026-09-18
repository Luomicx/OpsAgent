import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

/* 样式引入顺序有意义：令牌 → 基础 → 通用组件 → 外壳布局 → 各屏专属。
   不要打乱，否则后引入的会覆盖前面同特异性的规则。 */
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/screens/boot.css';
import './styles/screens/timeline.css';
import './styles/screens/panels.css';

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root 挂载点');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
