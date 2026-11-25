/** Offer explicit microphone and answer playback controls only for verified DeepSeek models. */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Check, ChevronDown, Mic, Square, Volume2, X } from "lucide-react";
import { DEEPSEEK_TTS_MAX_CHARACTERS } from "@shared/deepseek-voice";
import { startPcmRecording, type PcmRecording } from "../lib/pcm-recording";
import { useOverlayPresence } from "../hooks/useOverlayPresence";
import "../styles/deepseek-voice.css";

interface Props {
  scopeKey: string;
  disabled: boolean;
  answer: string;
  onTranscript(text: string): void;
}

type VoicePhase = "idle" | "requesting-microphone" | "recording" | "transcribing" | "synthesizing" | "playing";
type VoiceMenuPosition = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

/** Keep recordings, requests and object URLs scoped to the current model and chat. */
export function DeepSeekVoiceControls({ scopeKey, disabled, answer, onTranscript }: Props) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoice] = useState<"stella" | "tide">("stella");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<VoiceMenuPosition | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const menuId = useId();
  const statusId = useId();
  const voiceName = useId();
  const root = useRef<HTMLDivElement | null>(null);
  const { ref: menu, present: menuPresent } = useOverlayPresence<HTMLDivElement>(menuOpen);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const recording = useRef<PcmRecording | null>(null);
  const requestId = useRef<string | null>(null);
  const playback = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const generation = useRef(0);
  const transcript = useRef(onTranscript);
  transcript.current = onTranscript;

  /** Dismiss the optional panel without interrupting an explicit voice operation. */
  const closeMenu = useCallback((restoreFocus = false): void => {
    setMenuOpen(false);
    if (restoreFocus) menuTrigger.current?.focus();
  }, []);

  /** Anchor the portal to its trigger and keep it inside the visible work area. */
  const updateMenuPosition = useCallback((): void => {
    const trigger = root.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const pad = 12;
    const gap = 8;
    const width = Math.min(272, window.innerWidth - pad * 2);
    const above = rect.top - pad - gap;
    const below = window.innerHeight - rect.bottom - pad - gap;
    const placeAbove = above >= 240 || above >= below;
    const maxHeight = Math.max(120, Math.min(360, placeAbove ? above : below));
    setMenuPosition({
      left: Math.max(pad, Math.min(rect.left, window.innerWidth - width - pad)),
      width,
      maxHeight,
      ...(placeAbove ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
    });
  }, []);

  useLayoutEffect(() => {
    if (menuOpen) updateMenuPosition();
  }, [menuOpen, phase, updateMenuPosition]);

  const menuReady = menuPosition !== null;
  useEffect(() => {
    if (!menuOpen || !menuReady) return;
    const target = menu.current?.querySelector<HTMLElement>("[data-voice-initial-focus]:not(:disabled)")
      ?? menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    target?.focus();
  }, [menuOpen, menuReady, menu]);

  useEffect(() => {
    if (!menuOpen) return;
    /** Let pointer and Tab navigation dismiss the panel without moving focus back. */
    const onOutside = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && !root.current?.contains(target) && !menu.current?.contains(target)) closeMenu();
    };
    /** Restore the trigger for keyboard dismissal, matching the other composer menus. */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    };
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("focusin", onOutside);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("focusin", onOutside);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen, closeMenu, updateMenuPosition, menu]);

  useEffect(() => {
    if (phase !== "recording") return;
    const startedAt = Date.now();
    setRecordingSeconds(0);
    const timer = setInterval(() => setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (error) setMenuOpen(true);
  }, [error]);

  /** Stop playback and revoke its URL as soon as audio is no longer needed. */
  const releaseAudio = (): void => {
    if (playback.current) {
      playback.current.onended = null;
      playback.current.onerror = null;
      playback.current.pause();
      playback.current.removeAttribute("src");
      playback.current.load();
      playback.current = null;
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  };

  /** Invalidate all pending callbacks before stopping capture or network requests. */
  const dispose = (): void => {
    generation.current++;
    recording.current?.cancel();
    recording.current = null;
    if (requestId.current) void window.xAgent.turn.deepseekCancelVoice(requestId.current).catch(() => undefined);
    requestId.current = null;
    releaseAudio();
  };

  useEffect(() => {
    setPhase("idle");
    setError(null);
    closeMenu();
    return dispose;
    // The scope is the authoritative owner of these refs, not callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => {
    if (!disabled) return;
    dispose();
    setPhase("idle");
    closeMenu();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  /** Start capture and place the finished ASR text into the editable composer. */
  const startRecording = async (): Promise<void> => {
    if (disabled || phase !== "idle") return;
    setError(null);
    setPhase("requesting-microphone");
    setMenuOpen(true);
    const ownGeneration = ++generation.current;
    try {
      const handle = await startPcmRecording((audio) => {
        if (generation.current !== ownGeneration) return;
        recording.current = null;
        setPhase("transcribing");
        const id = crypto.randomUUID();
        requestId.current = id;
        void window.xAgent.turn.deepseekTranscribe({ requestId: id, audio }).then((result) => {
          if (generation.current !== ownGeneration) return;
          if (!result.ok) setError(result.error);
          else if (result.text.trim()) transcript.current(result.text);
          else setError("未识别到语音，请重试");
        }).catch(() => {
          if (generation.current === ownGeneration) setError("语音识别失败，请重试");
        }).finally(() => {
          if (generation.current !== ownGeneration) return;
          requestId.current = null;
          setPhase("idle");
        });
      });
      if (generation.current !== ownGeneration) { handle.cancel(); return; }
      recording.current = handle;
      setPhase("recording");
    } catch {
      if (generation.current !== ownGeneration) return;
      setError("无法使用麦克风，请检查 Windows 的麦克风隐私权限和输入设备");
      setPhase("idle");
    }
  };

  /** Request one answer on an explicit click and play only returned local audio bytes. */
  const speak = async (): Promise<void> => {
    if (disabled || phase !== "idle" || !answer.trim()) return;
    setError(null);
    setMenuOpen(true);
    if (Array.from(answer).length > DEEPSEEK_TTS_MAX_CHARACTERS) {
      setError("回答超过 10000 个字符，暂时无法完整朗读");
      return;
    }
    const ownGeneration = ++generation.current;
    const id = crypto.randomUUID();
    requestId.current = id;
    setPhase("synthesizing");
    try {
      const result = await window.xAgent.turn.deepseekSpeak({ requestId: id, text: answer, voice });
      if (generation.current !== ownGeneration) return;
      requestId.current = null;
      if (!result.ok) { setError(result.error); setPhase("idle"); return; }
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.audio).buffer], { type: "audio/wav" }));
      objectUrl.current = url;
      const audio = new Audio(url);
      playback.current = audio;
      audio.onended = () => { releaseAudio(); setPhase("idle"); };
      audio.onerror = () => { releaseAudio(); setError("音频播放失败，请重试"); setPhase("idle"); };
      setPhase("playing");
      await audio.play();
    } catch {
      if (generation.current !== ownGeneration) return;
      releaseAudio();
      setError("语音合成或播放失败，请重试");
      setPhase("idle");
    }
  };

  /** Make the primary button finish capture or cancel a pending/playback operation. */
  const onPrimaryClick = (): void => {
    if (phase === "recording") { recording.current?.stop(); return; }
    if (phase === "idle") { void startRecording(); return; }
    dispose();
    setPhase("idle");
    setError(null);
  };

  const active = phase !== "idle";
  const elapsed = `${Math.floor(recordingSeconds / 60).toString().padStart(2, "0")}:${(recordingSeconds % 60).toString().padStart(2, "0")}`;
  const status = {
    idle: "",
    "requesting-microphone": "正在请求麦克风…",
    recording: `正在录音 · ${elapsed}`,
    transcribing: "正在识别语音…",
    synthesizing: "正在生成语音…",
    playing: "正在朗读最新回答",
  }[phase];

  const primaryLabel = {
    idle: "语音输入",
    "requesting-microphone": "取消启用麦克风",
    recording: "完成录音",
    transcribing: "取消语音识别",
    synthesizing: "取消语音合成",
    playing: "停止朗读",
  }[phase];
  const primaryText = phase === "recording" ? "完成" : phase === "playing" ? "停止" : active ? "取消" : "语音";

  return <>
    <div ref={root} className="deepseek-voice-controls" data-phase={phase} data-error={error ? "true" : undefined} role="group" aria-label="DeepSeek 语音">
      <button type="button" className="deepseek-voice-primary" disabled={disabled}
        aria-label={primaryLabel} aria-describedby={active || error ? statusId : undefined}
        title={phase === "recording" ? "完成录音并识别" : status || error || "语音输入（最长 120 秒）"}
        aria-pressed={phase === "recording"} onClick={onPrimaryClick}>
        {phase === "idle" ? <Mic size={16} aria-hidden /> : phase === "recording" || phase === "playing" ? <Square size={14} aria-hidden /> : <X size={16} aria-hidden />}
        <span>{primaryText}</span>
      </button>
      <button ref={menuTrigger} type="button" className="deepseek-voice-menu-trigger" disabled={disabled}
        aria-label="语音选项" title="语音选项" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined}
        onClick={() => menuOpen ? closeMenu() : setMenuOpen(true)}>
        <ChevronDown size={14} aria-hidden />
      </button>
      <span id={statusId} className="deepseek-voice-announcement" role="status" aria-live="polite">{error ?? status}</span>
    </div>
    {menuPresent && menuPosition && createPortal(
      <div ref={menu} id={menuId} className="deepseek-voice-panel" role="dialog" aria-label="语音选项" style={menuPosition}
        inert={!menuOpen} data-side={menuPosition.bottom === undefined ? "below" : "above"}
        onKeyDown={(event) => {
          // Preserve native radio/Tab navigation without invoking the composer's Shift+Tab mode shortcut.
          if (event.key === "Tab") event.stopPropagation();
        }}>
        <div className="deepseek-voice-panel-header">
          <span>语音</span>
          <button type="button" className="deepseek-voice-close" aria-label="关闭语音选项" title="关闭语音选项" onClick={() => closeMenu(true)}><X size={16} aria-hidden /></button>
        </div>
        {active && <div className="deepseek-voice-activity" data-phase={phase}>
          <div className="deepseek-voice-activity-label"><AudioLines size={16} aria-hidden /><span>{status}</span></div>
          {phase === "recording" && <p>点击“完成”后转换为文字，最长 120 秒。</p>}
          <button type="button" className="deepseek-voice-cancel" aria-label="取消语音" data-voice-initial-focus
            onClick={() => { dispose(); setPhase("idle"); setError(null); }}>
            <X size={14} aria-hidden />{phase === "playing" ? "停止朗读" : "取消语音"}
          </button>
        </div>}
        {error && <p className="deepseek-voice-error">{error}</p>}
        <button type="button" className="deepseek-voice-read" disabled={disabled || active || !answer.trim()} data-voice-initial-focus
          aria-label="朗读最新回答" title={answer.trim() ? "朗读最新回答" : "回答完成后可朗读"} onClick={() => void speak()}>
          <Volume2 size={17} aria-hidden />
          <span><span className="deepseek-voice-read-label">朗读最新回答</span>{!answer.trim() && <span className="deepseek-voice-read-hint">回答完成后可用</span>}</span>
        </button>
        <fieldset className="deepseek-voice-voices" role="radiogroup" aria-label="朗读音色" disabled={disabled || active}>
          <legend>朗读音色</legend>
          <div className="deepseek-voice-choice-row">
            {(["stella", "tide"] as const).map((value) => <label key={value} className="deepseek-voice-choice">
              <input type="radio" name={voiceName} value={value} checked={voice === value} data-voice-initial-focus={voice === value || undefined}
                aria-label={value === "stella" ? "Stella" : "Tide"} onChange={() => setVoice(value)} />
              <span>{value === "stella" ? "Stella" : "Tide"}</span><Check size={14} aria-hidden />
            </label>)}
          </div>
        </fieldset>
      </div>, document.body,
    )}
  </>;
}
