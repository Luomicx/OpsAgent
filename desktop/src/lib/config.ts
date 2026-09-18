/**
 * 配置持久化 —— 主机、用户名、适配器这些「下次还要用」的值存 localStorage。
 *
 * 刻意不存 prompt（一次性输入）与任何凭据。
 */

import { useCallback, useEffect, useState } from "react";
import type { RunOptions } from "./types";

const KEY = "ops-agent.desktop.config.v1";

const DEFAULTS: RunOptions = {
  host: "demo-host",
  user: "",
  prompt: "",
  adapter: "mock",
};

export interface PersistedConfig {
  host: string;
  user: string;
  adapter: "mock" | "deepseek";
}

function load(): PersistedConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { host: DEFAULTS.host, user: DEFAULTS.user, adapter: DEFAULTS.adapter };
    const parsed = JSON.parse(raw) as Partial<PersistedConfig>;
    return {
      host: typeof parsed.host === "string" ? parsed.host : DEFAULTS.host,
      user: typeof parsed.user === "string" ? parsed.user : DEFAULTS.user,
      adapter: parsed.adapter === "deepseek" ? "deepseek" : "mock",
    };
  } catch {
    return { host: DEFAULTS.host, user: DEFAULTS.user, adapter: DEFAULTS.adapter };
  }
}

export function usePersistedConfig() {
  const [config, setConfig] = useState<PersistedConfig>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(config));
    } catch {
      // 存储不可用（隐私模式）时静默降级为「仅本次会话」
    }
  }, [config]);

  const patch = useCallback((next: Partial<PersistedConfig>) => {
    setConfig((prev) => ({ ...prev, ...next }));
  }, []);

  return { config, patch };
}
