import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import {
  isScrollInsidePanel,
  resolveMenuScrollTarget,
  shouldScrollOptionIntoView,
  type MenuHighlightReason,
} from "@/lib/select-menu-scroll";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
};

type Variant = "pill" | "control" | "block";

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
  title?: string;
  className?: string;
  variant?: Variant;
  placeholder?: string;
};

type MenuPos = {
  left: number;
  width: number;
  maxHeight: number;
} & ({ top: number; bottom?: undefined } | { top?: undefined; bottom: number });

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function SelectMenu(props: Props) {
  const {
    value,
    options,
    onChange,
    disabled = false,
    title,
    className,
    variant = "control",
    placeholder = "请选择",
  } = props;
  const ariaLabel = props["aria-label"];

  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const highlightReasonRef = useRef<MenuHighlightReason>("open");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [highlight, setHighlight] = useState(-1);

  const setHighlightFrom = useCallback(
    (index: number, reason: MenuHighlightReason) => {
      highlightReasonRef.current = reason;
      setHighlight(index);
    },
    [],
  );

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  const enabledIndexes = useMemo(
    () =>
      options
        .map((o, i) => (o.disabled ? -1 : i))
        .filter((i) => i >= 0),
    [options],
  );

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  const openMenu = useCallback(() => {
    if (disabled || options.length === 0) return;
    const selectedIdx = options.findIndex((o) => o.value === value);
    const start =
      selectedIdx >= 0 && !options[selectedIdx]?.disabled
        ? selectedIdx
        : (enabledIndexes[0] ?? 0);
    setHighlightFrom(start, "open");
    setOpen(true);
  }, [disabled, enabledIndexes, options, setHighlightFrom, value]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const viewportPad = 8;
    const preferredHeight = Math.min(320, window.innerHeight * 0.5);
    const spaceBelow = window.innerHeight - rect.bottom - viewportPad - gap;
    const spaceAbove = rect.top - viewportPad - gap;
    const placeBelow =
      spaceBelow >= Math.min(160, preferredHeight) || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(
      120,
      Math.min(preferredHeight, placeBelow ? spaceBelow : spaceAbove),
    );
    const width = Math.min(
      Math.max(rect.width, variant === "pill" ? 200 : rect.width),
      window.innerWidth - viewportPad * 2,
    );
    const left = clamp(
      rect.left,
      viewportPad,
      window.innerWidth - width - viewportPad,
    );
    // Prefer bottom anchoring when opening upward so a short panel hugs the
    // trigger; top = rect.top - maxHeight leaves a gap when content < maxHeight.
    if (placeBelow) {
      setPos({ top: rect.bottom + gap, left, width, maxHeight });
    } else {
      setPos({
        bottom: window.innerHeight - rect.top + gap,
        left,
        width,
        maxHeight,
      });
    }
  }, [variant]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition, options.length]);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    if (!shouldScrollOptionIntoView(highlightReasonRef.current)) return;
    const el = resolveMenuScrollTarget(panelRef.current);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        triggerRef.current?.focus();
        return;
      }
      if (enabledIndexes.length === 0) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const curPos = enabledIndexes.indexOf(highlight);
        const base = curPos >= 0 ? curPos : dir > 0 ? -1 : 0;
        const next =
          enabledIndexes[
            (base + dir + enabledIndexes.length) % enabledIndexes.length
          ]!;
        setHighlightFrom(next, "keyboard");
        return;
      }

      if (e.key === "Home") {
        e.preventDefault();
        setHighlightFrom(enabledIndexes[0]!, "keyboard");
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setHighlightFrom(
          enabledIndexes[enabledIndexes.length - 1]!,
          "keyboard",
        );
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const opt = options[highlight];
        if (opt && !opt.disabled) {
          onChange(opt.value);
          close();
          triggerRef.current?.focus();
        }
      }
    };
    const onResize = () => updatePosition();
    const onScroll = (e: Event) => {
      // Panel overflow scroll must not reposition (or re-render) the menu.
      if (isScrollInsidePanel(panelRef.current, e.target as Node | null)) {
        return;
      }
      updatePosition();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [
    close,
    enabledIndexes,
    highlight,
    onChange,
    open,
    options,
    setHighlightFrom,
    updatePosition,
  ]);

  const displayLabel = selected?.label ?? placeholder;

  return (
    <div
      ref={rootRef}
      className={[
        "select-menu",
        `select-menu-${variant}`,
        open ? "is-open" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        ref={triggerRef}
        type="button"
        className="select-menu-trigger"
        disabled={disabled}
        title={title ?? selected?.title ?? displayLabel}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : openMenu())}
      >
        <span className="select-menu-value">{displayLabel}</span>
        <ChevronDown size={14} className="select-menu-caret" aria-hidden />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            id={listId}
            className={["select-menu-panel", className].filter(Boolean).join(" ")}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
          >
            {options.map((opt, index) => {
              const isSelected = opt.value === value;
              const isHighlighted = index === highlight;
              return (
                <button
                  key={`${opt.value}::${index}`}
                  type="button"
                  role="option"
                  className={[
                    "select-menu-option",
                    isSelected ? "is-selected" : "",
                    isHighlighted ? "is-highlighted" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-selected={isSelected}
                  data-highlighted={isHighlighted || undefined}
                  disabled={opt.disabled}
                  title={opt.title ?? opt.label}
                  onMouseEnter={() => {
                    if (!opt.disabled) setHighlightFrom(index, "pointer");
                  }}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    close();
                    triggerRef.current?.focus();
                  }}
                >
                  <span className="select-menu-option-label">{opt.label}</span>
                  {isSelected && (
                    <Check
                      size={14}
                      strokeWidth={2}
                      className="select-menu-check"
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
