import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmDialog, type ConfirmTone } from "../components/ConfirmDialog";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type ConfirmContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

type Pending = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  // 用 ref 持有当前 pending 的 resolve —— setState 只能异步触发渲染，
  // 而旧实现里 sync 覆盖 ref 会导致上一个 Promise 永远 pending。
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    // 关键修复：若有尚未关闭的 pending，新 confirm 启动前先把旧的当作「取消」。
    // 这覆盖了几种真实场景：
    //   1) 用户/外部事件快速连续触发 confirm()（toggle 按钮双击、键盘连按等）
    //   2) 同一个 onClick 里业务代码连续触发 confirm()
    // 旧实现下，pendingRef.current 被覆盖后，第一次的 resolve 函数丢失，
    // 第一次的 await confirm(...) 永远不返回，业务动作被吞掉。
    if (pendingRef.current) {
      const prev = pendingRef.current;
      prev.resolve(false);
      pendingRef.current = null;
    }
    return new Promise<boolean>((resolve) => {
      const next: Pending = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const close = useCallback((value: boolean) => {
    const cur = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    cur?.resolve(value);
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <ConfirmDialog
          title={pending.title}
          message={pending.message}
          confirmLabel={pending.confirmLabel}
          cancelLabel={pending.cancelLabel}
          tone={pending.tone}
          onCancel={() => close(false)}
          onConfirm={() => close(true)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue["confirm"] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return ctx.confirm;
}
