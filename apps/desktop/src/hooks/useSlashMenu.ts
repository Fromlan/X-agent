/**
 * Slash menu 数据派生与选择 —— 从 ChatPanel 抽出。
 * 不接管 onKeyDown / onChange / onSelect —— 这些与 textarea 紧耦合,留在 ChatPanel。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionSlashItem } from "@shared/ipc";
import {
  applySlashItemInsert,
  detectSlashFragment,
  filterSlashItemsByQuery,
  type SlashMatch,
} from "@/lib/slash-menu";

export interface UseSlashMenuOpts {
  input: string;
  cursor: number;
  disabled: boolean;
  skillsRefreshKey?: string | number;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setInput: (v: string) => void;
}

export interface UseSlashMenuResult {
  slashMatch: SlashMatch | null;
  menuOpen: boolean;
  filtered: SessionSlashItem[];
  highlight: number;
  setHighlight: React.Dispatch<React.SetStateAction<number>>;
  selectSlashItem: (item: SessionSlashItem) => void;
  dismissMenu: () => void;
  resetDismiss: () => void;
}

export function useSlashMenu(opts: UseSlashMenuOpts): UseSlashMenuResult {
  const { input, cursor, disabled, skillsRefreshKey, textareaRef, setInput } = opts;
  const [slashItems, setSlashItems] = useState<SessionSlashItem[]>([]);
  const [slashItemsLoaded, setSlashItemsLoaded] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);

  const slashMatch: SlashMatch | null = useMemo(() => {
    if (disabled) return null;
    return detectSlashFragment(input, cursor);
  }, [disabled, input, cursor]);

  const menuOpen = Boolean(slashMatch) && !menuDismissed;

  const filtered = useMemo(
    () => filterSlashItemsByQuery(slashItems, slashMatch?.query ?? ""),
    [slashItems, slashMatch?.query],
  );

  useEffect(() => {
    setSlashItemsLoaded(false);
    setSlashItems([]);
  }, [skillsRefreshKey, disabled]);

  useEffect(() => {
    if (!menuOpen || slashItemsLoaded || disabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await window.xAgent.session.listSessionSlashItems();
        if (!cancelled) {
          setSlashItems(list);
          setSlashItemsLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setSlashItems([]);
          setSlashItemsLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [menuOpen, slashItemsLoaded, disabled]);

  useEffect(() => {
    setHighlight(0);
  }, [slashMatch?.query, slashMatch?.start]);

  useEffect(() => {
    if (!slashMatch) setMenuDismissed(false);
  }, [slashMatch]);

  const selectSlashItem = useCallback(
    (item: SessionSlashItem) => {
      const match = detectSlashFragment(
        input,
        textareaRef.current?.selectionStart ?? cursor,
      );
      if (!match) return;
      const { value, cursor: nextCursor } = applySlashItemInsert(
        input,
        match,
        item,
      );
      setInput(value);
      setMenuDismissed(true);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [cursor, input, setInput, textareaRef],
  );

  const resetDismiss = useCallback(() => setMenuDismissed(false), []);
  const dismissMenu = useCallback(() => setMenuDismissed(true), []);

  return {
    slashMatch,
    menuOpen,
    filtered,
    highlight,
    setHighlight,
    selectSlashItem,
    dismissMenu,
    resetDismiss,
  };
}