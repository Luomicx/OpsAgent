import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../ui/Icon';
import { Banner, Body, Card, CardHead, Label, PageHeader } from '../layout/AppShell';
import { Btn, Chip, Code, Tag } from '../ui/primitives';
import type { AppCtx } from '../../lib/appCtx';
import { api, type RulesPayload } from '../../lib/api';
import type { PermissionLayer } from '../../lib/types';

/** 可编辑规则（只含后端真实存在的字段，不发明概念） */
interface Draft {
  key: string;
  layer: string;
  pattern: string;
  kind: string;
  description: string;
}

const LAYER_TONE: Record<string, 'bad' | 'warn' | 'pur' | 'ac'> = {
  L1: 'bad',
  L2: 'warn',
  L3: 'pur',
};

/**
 * 11 · 权限规则编辑器（决策 1B —— 可写）
 *
 * 读取：真实（`permission` RPC）
 * 写入：走 `rulesDiff` → 二次确认 → `rulesSave` 的完整流程。
 * 后端尚未实现这两个方法，调用会返回 -32601，界面**原样呈现该错误**，
 * 绝不在未真正写入时假装成功。
 *
 * 安全约束（docs/UI-REFACTOR-PLAN.md §7.4）：
 *   ① 只写 .local.yaml 覆盖文件  ② 写入前二次确认并展示 diff
 *   ③ 后端落审计事件            ④ 保存后重载并回报结果
 */
export default function RulesScreen({ app }: { app: AppCtx }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [original, setOriginal] = useState<Draft[]>([]);
  const [layers, setLayers] = useState<PermissionLayer[]>([]);
  const [activeLayer, setActiveLayer] = useState<string>('L2');
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  /* 写入流程 */
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const report = await api.permission();
      setLayers(report.layers);
      const list: Draft[] = report.layers.flatMap((l) =>
        l.rules.map((r, i) => ({
          key: `${l.layer}:${i}:${r.pattern}`,
          layer: l.layer,
          pattern: r.pattern,
          kind: r.kind,
          description: r.description,
        })),
      );
      setDrafts(list);
      setOriginal(list.map((d) => ({ ...d })));
      if (report.layers.length > 0 && !report.layers.some((l) => l.layer === activeLayer)) {
        setActiveLayer(report.layers[0].layer);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [activeLayer]);

  useEffect(() => {
    void load();
    // 仅在挂载时加载一次，避免切层重置编辑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- 变更检测 ---------------- */
  const changes = useMemo(() => {
    const orig = new Map(original.map((d) => [d.key, d]));
    const added = drafts.filter((d) => !orig.has(d.key));
    const removed = original.filter((d) => !drafts.some((x) => x.key === d.key));
    const changed = drafts
      .filter((d) => {
        const o = orig.get(d.key);
        return o && (o.pattern !== d.pattern || o.kind !== d.kind || o.description !== d.description);
      })
      .map((d) => {
        const o = orig.get(d.key)!;
        const parts: string[] = [];
        if (o.pattern !== d.pattern) parts.push(`pattern: ${o.pattern} → ${d.pattern}`);
        if (o.kind !== d.kind) parts.push(`kind: ${o.kind} → ${d.kind}`);
        if (o.description !== d.description) parts.push(`description: ${o.description} → ${d.description}`);
        return { key: d.key, layer: d.layer, detail: parts.join('；') };
      });
    return { added, removed, changed, dirty: added.length + removed.length + changed.length };
  }, [drafts, original]);

  const layerDrafts = drafts.filter((d) => d.layer === activeLayer);
  const cur = drafts.find((d) => d.key === selected) ?? null;

  const patch = (key: string, next: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...next } : d)));

  /* ---------------- 保存：diff → 确认 → 写入 ---------------- */
  const doSave = async () => {
    setConfirming(false);
    setSaving(true);
    setSaveError('');
    setSaved(null);

    const payload: RulesPayload = {
      layers: layers.map((l) => ({
        layer: l.layer,
        rules: drafts
          .filter((d) => d.layer === l.layer)
          .map(({ pattern, kind, description }) => ({ pattern, kind, description })),
      })),
    };

    try {
      const diff = await api.rulesDiff(payload);
      if (diff.invalid.length > 0) {
        setSaveError(`后端校验未通过：${diff.invalid.map((i) => `${i.pattern}（${i.reason}）`).join('；')}`);
        return;
      }
      const out = await api.rulesSave(payload);
      setOriginal(drafts.map((d) => ({ ...d })));
      setSaved(
        `已写入 ${out.targetFile} · 生效规则 ${out.totalRules} 条` +
          (out.auditSeq ? ` · 审计事件 #${out.auditSeq}` : ''),
      );
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="main">
      <PageHeader
        title="权限规则"
        sub="只写覆盖文件 configs/permission_rules.local.yaml · 默认规则文件保持不动"
        leading={
          <Btn tone="gh" icon="i-chev-l" onClick={() => app.go('permissions')} style={{ height: 30 }}>
            返回
          </Btn>
        }
        actions={
          <>
            {changes.dirty > 0 && (
              <Tag tone="warn">
                <Icon name="i-alert" size="s" />
                {changes.dirty} 处未保存
              </Tag>
            )}
            <Btn
              tone="gh"
              disabled={changes.dirty === 0}
              onClick={() => {
                setDrafts(original.map((d) => ({ ...d })));
                setSaveError('');
              }}
            >
              还原
            </Btn>
            <Btn
              tone="pri"
              icon="i-check"
              disabled={changes.dirty === 0 || saving}
              onClick={() => setConfirming(true)}
            >
              {saving ? '保存中…' : '保存并重载'}
            </Btn>
          </>
        }
      />

      <Body>
        <Banner tone="warn" icon="i-alert">
          <b>修改权限规则会直接影响安全边界。</b>
          写入只落在 <span className="mono">.local.yaml</span> 覆盖文件（默认规则文件不动，删除该文件即可恢复）；
          保存前会展示完整 diff 并要求二次确认；写入会记录审计事件。
        </Banner>

        {error && (
          <Banner tone="bad" icon="i-alert">
            读取规则失败：<span className="selectable">{error}</span>
          </Banner>
        )}

        {saveError && (
          <Banner tone="bad" icon="i-alert">
            <b>保存失败</b>：<span className="selectable">{saveError}</span>
            <br />
            <span style={{ color: 'var(--t3)' }}>
              若提示 <span className="mono">-32601 Method not found</span>，说明后端的{' '}
              <span className="mono">rulesSave</span> 尚未实现（Phase 4）。本次变更**没有写入磁盘**。
            </span>
          </Banner>
        )}

        {saved && (
          <Banner tone="ok" icon="i-check">
            {saved}
          </Banner>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 330px', gap: 14, flex: 1, minHeight: 0 }}>
          {/* --- 规则表 --- */}
          <Card style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <CardHead
              title="规则清单"
              right={
                <>
                  {(layers.length > 0 ? layers.map((l) => l.layer) : ['L1', 'L2', 'L3']).map((L) => (
                    <Chip key={L} on={activeLayer === L} onClick={() => setActiveLayer(L)}>
                      {L}
                    </Chip>
                  ))}
                  <Tag mono>{layerDrafts.length} 条</Tag>
                </>
              }
            />
            <div style={{ overflow: 'auto', flex: 1 }}>
              <table className="tbl rl-tbl tc">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>层</th>
                    <th>匹配模式</th>
                    <th style={{ width: 96 }}>类型</th>
                    <th style={{ width: 220 }}>说明</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {layerDrafts.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--t4)' }}>
                        {loading ? '读取中…' : '该层没有规则'}
                      </td>
                    </tr>
                  )}
                  {layerDrafts.map((d) => {
                    const o = original.find((x) => x.key === d.key);
                    const isNew = !o;
                    const isEdited =
                      !!o && (o.pattern !== d.pattern || o.kind !== d.kind || o.description !== d.description);
                    return (
                      <tr
                        key={d.key}
                        onClick={() => setSelected(d.key)}
                        style={{
                          cursor: 'pointer',
                          background: isNew
                            ? 'rgba(69,185,141,.05)'
                            : isEdited
                              ? 'rgba(216,164,63,.05)'
                              : undefined,
                        }}
                      >
                        <td>
                          <Tag tone={LAYER_TONE[d.layer] ?? 'ac'}>{d.layer}</Tag>
                        </td>
                        <td>
                          <span className="pat selectable">{d.pattern}</span>
                        </td>
                        <td>
                          <Tag>{d.kind}</Tag>
                        </td>
                        <td style={{ fontSize: 11.5 }}>{d.description || '—'}</td>
                        <td>
                          {isNew ? (
                            <Tag tone="ok">新增</Tag>
                          ) : isEdited ? (
                            <Tag tone="warn">改</Tag>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* --- 编辑面板 --- */}
          <Card style={{ display: 'flex', flexDirection: 'column' }}>
            <CardHead
              title="编辑规则"
              right={
                cur ? (
                  <button className="ib" title="删除该规则" onClick={() => {
                    setDrafts((prev) => prev.filter((x) => x.key !== cur.key));
                    setSelected(null);
                  }}>
                    <Icon name="i-trash" size="s" />
                  </button>
                ) : undefined
              }
            />
            {cur ? (
              <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 13, flex: 1 }}>
                <div className="fld">
                  <label>所属层</label>
                  <div className="inp" style={{ justifyContent: 'space-between' }}>
                    {cur.layer}
                    <Icon name="i-chev-d" size="s" />
                  </div>
                </div>
                <div className="fld">
                  <label>匹配模式</label>
                  <div className="inp">
                    <input
                      className="mono"
                      value={cur.pattern}
                      onChange={(e) => patch(cur.key, { pattern: e.target.value })}
                    />
                  </div>
                  <span style={{ fontSize: 10.5, color: 'var(--t4)' }}>
                    正则或字面量；后端会做静态校验
                  </span>
                </div>
                <div className="fld">
                  <label>类型</label>
                  <div className="inp">
                    <input
                      value={cur.kind}
                      onChange={(e) => patch(cur.key, { kind: e.target.value })}
                    />
                  </div>
                </div>
                <div className="fld">
                  <label>说明</label>
                  <div className="inp" style={{ height: 'auto', minHeight: 64, alignItems: 'flex-start', padding: '9px 12px' }}>
                    <textarea
                      value={cur.description}
                      onChange={(e) => patch(cur.key, { description: e.target.value })}
                      style={{ fontSize: 12.5 }}
                    />
                  </div>
                </div>

                <Btn
                  icon="i-plus"
                  onClick={() => {
                    const key = `${activeLayer}:new:${Date.now()}`;
                    setDrafts((prev) => [
                      ...prev,
                      { key, layer: activeLayer, pattern: '', kind: '正则', description: '' },
                    ]);
                    setSelected(key);
                  }}
                >
                  在 {activeLayer} 新增一条
                </Btn>

                <Banner tone="info" icon="i-info" style={{ marginTop: 'auto' }}>
                  只提交 <span className="mono">pattern / kind / description</span> 三个字段 ——
                  不发明后端不存在的数据结构。
                </Banner>
              </div>
            ) : (
              <div className="pad" style={{ color: 'var(--t4)', fontSize: 12.5 }}>
                从左侧选一条规则开始编辑。
              </div>
            )}
          </Card>
        </div>
      </Body>

      {/* ---------------- 二次确认 ---------------- */}
      {confirming && (
        <div className="modal-mask" onClick={() => setConfirming(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="hd">
              <Icon name="i-alert" size="s" />
              <h3>确认写入权限规则？</h3>
              <span className="sp" />
              <Tag tone="warn">{changes.dirty} 处变更</Tag>
            </div>
            <div className="pad" style={{ maxHeight: 320, overflow: 'auto' }}>
              <Code>
                目标文件：configs/permission_rules.local.yaml（覆盖文件，默认规则不动）
                {'\n'}新增 {changes.added.length} · 修改 {changes.changed.length} · 删除 {changes.removed.length}
              </Code>

              {changes.added.length > 0 && (
                <>
                  <Label block>新增</Label>
                  {changes.added.map((d) => (
                    <div key={d.key} className="mono" style={{ fontSize: 11.5, color: 'var(--ok)', marginBottom: 4 }}>
                      + [{d.layer}] {d.pattern}
                    </div>
                  ))}
                </>
              )}
              {changes.changed.length > 0 && (
                <>
                  <Label block>修改</Label>
                  {changes.changed.map((c) => (
                    <div key={c.key} className="mono" style={{ fontSize: 11.5, color: 'var(--warn)', marginBottom: 4 }}>
                      ~ [{c.layer}] {c.detail}
                    </div>
                  ))}
                </>
              )}
              {changes.removed.length > 0 && (
                <>
                  <Label block>删除</Label>
                  {changes.removed.map((d) => (
                    <div key={d.key} className="mono" style={{ fontSize: 11.5, color: 'var(--bad)', marginBottom: 4 }}>
                      − [{d.layer}] {d.pattern}
                    </div>
                  ))}
                </>
              )}

              <Banner tone="warn" icon="i-shield" style={{ marginTop: 14 }}>
                保存后流水线会立即重载，新规则即刻生效。
              </Banner>
            </div>
            <div className="hd" style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }}>
              <span className="sp" />
              <Btn tone="gh" onClick={() => setConfirming(false)}>
                取消
              </Btn>
              <Btn tone="pri" icon="i-check" onClick={() => void doSave()}>
                确认写入
              </Btn>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
