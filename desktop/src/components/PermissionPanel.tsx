import type { PermissionReport } from "../lib/types";

const LAYER_COLOR: Record<string, string> = {
  L1: "var(--layer-l1)",
  L2: "var(--layer-l2)",
  L3: "var(--layer-l3)",
};

interface Props {
  report: PermissionReport | null;
  loading: boolean;
  error: string;
}

export function PermissionPanel({ report, loading, error }: Props) {
  if (loading) {
    return (
      <div className="panel-scroll">
        <div className="empty">
          <span className="spinner" />
          <div>正在读取权限规则…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-scroll">
        <div className="empty">
          <div className="big">!</div>
          <div>{error}</div>
        </div>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="panel-scroll">
      <div className="meta-grid">
        <div className="meta-cell">
          <div className="meta-label">权限层</div>
          <div className="meta-value">{report.layers.length}</div>
        </div>
        <div className="meta-cell">
          <div className="meta-label">规则总数</div>
          <div className="meta-value">{report.totalRules}</div>
        </div>
        <div className="meta-cell">
          <div className="meta-label">校验顺序</div>
          <div className="meta-value sm">短路返回</div>
        </div>
      </div>

      {report.layers.map((layer) => {
        const color = LAYER_COLOR[layer.layer] ?? "var(--text-dim)";
        return (
          <div className="layer-card" key={layer.layer}>
            <div className="layer-head">
              <span className="layer-id" style={{ background: color }}>
                {layer.layer}
              </span>
              <span className="layer-name">{layer.name}</span>
              <span className="layer-desc">
                {layer.ruleCount} 条规则 · {layer.description}
              </span>
            </div>

            {layer.rules.length > 0 && (
              <div className="layer-rules">
                {layer.rules.slice(0, 80).map((rule, i) => (
                  <span
                    className="rule-chip"
                    key={`${layer.layer}-${i}`}
                    title={rule.description || rule.pattern}
                  >
                    {rule.pattern || "(空)"}
                  </span>
                ))}
                {layer.rules.length > 80 && (
                  <span className="rule-chip" style={{ color: "var(--text-faint)" }}>
                    还有 {layer.rules.length - 80} 条…
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
