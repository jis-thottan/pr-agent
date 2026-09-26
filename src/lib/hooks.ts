"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** Minimal data-fetching hook: { data, error, loading, reload }. Pass null to skip. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);

  const load = useCallback(
    async (suffix = "") => {
      if (!path) return;
      const id = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await api<T>(path + suffix);
        if (id === seq.current) setData(res);
      } catch (err) {
        if (id === seq.current) setError((err as Error).message);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

export type Connection = {
  id: string;
  provider: "github" | "azure_devops";
  name: string;
  baseUrl: string;
  accountLogin: string | null;
  createdAt: string;
};

export type AiProviderInfo = {
  id: string;
  name: string;
  type: "openai_compatible";
  baseUrl: string;
  model: string;
  temperature: number;
  maxContextTokens: number;
  jsonMode: boolean;
  isLocal: boolean;
  isDefault: boolean;
  hasApiKey: boolean;
};
