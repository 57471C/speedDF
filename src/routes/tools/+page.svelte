<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    backspace,
    clearAll,
    clearEntry,
    createCalculatorState,
    inputDigit,
    inputEquals,
    inputOperator,
    pasteValue,
    percent,
    toggleSign,
    type CalcOp,
    type CalculatorState,
  } from "../../lib/tools/calculator";
  import { formatCountdown, formatStopwatch } from "../../lib/tools/formatTime";
  import {
    MAGIC_8_BALL_SHAKE_MS,
    pickMagic8BallAnswer,
  } from "../../lib/tools/magic8Ball";
  import {
    loadScratchPadHtml,
    saveScratchPadHtml,
    stripFontStylesFromHtml,
  } from "../../lib/tools/scratchPad";

  type ToolsMode =
    | "calculator"
    | "timer"
    | "stopwatch"
    | "magic8ball"
    | "scratchpad";

  let mode = $state<ToolsMode>("calculator");

  // ── Calculator ──────────────────────────────────────────
  let calc = $state<CalculatorState>(createCalculatorState());

  function onCalcDigit(d: string) {
    calc = inputDigit(calc, d);
  }
  function onCalcOp(op: CalcOp) {
    calc = inputOperator(calc, op);
  }
  function onCalcEquals() {
    calc = inputEquals(calc);
  }
  function onCalcClear() {
    calc = clearAll();
  }
  function onCalcCE() {
    calc = clearEntry(calc);
  }
  function onCalcBack() {
    calc = backspace(calc);
  }
  function onCalcSign() {
    calc = toggleSign(calc);
  }
  function onCalcPercent() {
    calc = percent(calc);
  }

  async function onCalcPaste() {
    try {
      const text = await navigator.clipboard.readText();
      calc = pasteValue(calc, text);
    } catch (e) {
      console.warn("Clipboard paste failed:", e);
    }
  }

  // ── Timer ───────────────────────────────────────────────
  const PRESETS_MIN = [5, 10, 15, 30] as const;
  let timerRemainingMs = $state(5 * 60 * 1000);
  let timerInitialMs = $state(5 * 60 * 1000);
  let timerRunning = $state(false);
  let timerDone = $state(false);
  let timerRaf: number | null = null;
  let timerLastTs = 0;

  /** Editable fields (shown when stopped). */
  let editHours = $state("0");
  let editMinutes = $state("5");
  let editSeconds = $state("0");

  function msToParts(ms: number): { h: number; m: number; s: number } {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    return {
      h: Math.floor(totalSec / 3600),
      m: Math.floor((totalSec % 3600) / 60),
      s: totalSec % 60,
    };
  }

  function partsToMs(h: number, m: number, s: number): number {
    const hh = Math.min(99, Math.max(0, Math.floor(h) || 0));
    const mm = Math.min(59, Math.max(0, Math.floor(m) || 0));
    const ss = Math.min(59, Math.max(0, Math.floor(s) || 0));
    return ((hh * 3600) + (mm * 60) + ss) * 1000;
  }

  function syncEditFieldsFromMs(ms: number) {
    const { h, m, s } = msToParts(ms);
    editHours = String(h);
    editMinutes = String(m);
    editSeconds = String(s);
  }

  function clampEditField(raw: string, max: number): string {
    if (raw.trim() === "") return "0";
    const n = Number.parseInt(raw.replace(/\D/g, ""), 10);
    if (!Number.isFinite(n)) return "0";
    return String(Math.min(max, Math.max(0, n)));
  }

  function readEditFieldsMs(): number {
    editHours = clampEditField(editHours, 99);
    editMinutes = clampEditField(editMinutes, 59);
    editSeconds = clampEditField(editSeconds, 59);
    const ms = partsToMs(
      Number(editHours),
      Number(editMinutes),
      Number(editSeconds),
    );
    // Zero duration is useless — leave at least 1s if user clears all
    return ms > 0 ? ms : 1000;
  }

  /** Commit editable fields as a new full duration (presets / blur / idle start). */
  function applyEditableTime() {
    if (timerRunning) return;
    const next = readEditFieldsMs();
    syncEditFieldsFromMs(next);
    timerInitialMs = next;
    timerRemainingMs = next;
    timerDone = false;
  }

  function setTimerPreset(minutes: number) {
    stopTimerLoop();
    timerRunning = false;
    timerDone = false;
    timerInitialMs = minutes * 60 * 1000;
    timerRemainingMs = timerInitialMs;
    syncEditFieldsFromMs(timerInitialMs);
  }

  function startTimerLoop() {
    stopTimerLoop();
    timerLastTs = performance.now();
    const tick = (now: number) => {
      if (!timerRunning) return;
      const delta = now - timerLastTs;
      timerLastTs = now;
      timerRemainingMs = Math.max(0, timerRemainingMs - delta);
      if (timerRemainingMs <= 0) {
        timerRemainingMs = 0;
        timerRunning = false;
        timerDone = true;
        syncEditFieldsFromMs(timerInitialMs);
        try {
          // Brief system beep via Web Audio if available
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          gain.gain.value = 0.15;
          osc.start();
          osc.stop(ctx.currentTime + 0.35);
          setTimeout(() => ctx.close(), 500);
        } catch {
          /* ignore audio failures */
        }
        return;
      }
      timerRaf = requestAnimationFrame(tick);
    };
    timerRaf = requestAnimationFrame(tick);
  }

  function stopTimerLoop() {
    if (timerRaf !== null) {
      cancelAnimationFrame(timerRaf);
      timerRaf = null;
    }
  }

  function toggleTimer() {
    if (timerRunning) {
      timerRunning = false;
      stopTimerLoop();
      // Show remaining so user can tweak or read it while paused
      syncEditFieldsFromMs(timerRemainingMs);
      return;
    }

    // Starting / resuming
    if (timerDone || timerRemainingMs <= 0) {
      applyEditableTime();
      timerDone = false;
    } else if (timerRemainingMs === timerInitialMs) {
      // Idle at full duration — pick up any uncommitted edits
      applyEditableTime();
    } else {
      // Paused mid-countdown: only rewrite if fields were changed
      const edited = readEditFieldsMs();
      const remainingRounded = Math.floor(timerRemainingMs / 1000) * 1000;
      if (edited !== remainingRounded) {
        // User typed a new value while paused — treat as new duration
        timerInitialMs = edited;
        timerRemainingMs = edited;
        syncEditFieldsFromMs(edited);
      }
    }

    timerRunning = true;
    startTimerLoop();
  }

  function resetTimer() {
    stopTimerLoop();
    timerRunning = false;
    timerDone = false;
    timerRemainingMs = timerInitialMs;
    syncEditFieldsFromMs(timerInitialMs);
  }

  function onEditTimeKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      applyEditableTime();
      (e.target as HTMLInputElement)?.blur();
    }
    // Don't let Escape close the window while editing a field
    if (e.key === "Escape") {
      e.stopPropagation();
      syncEditFieldsFromMs(timerRemainingMs);
      (e.target as HTMLInputElement)?.blur();
    }
  }

  // ── Stopwatch ───────────────────────────────────────────
  let swElapsedMs = $state(0);
  let swRunning = $state(false);
  let swLaps = $state<number[]>([]);
  let swRaf: number | null = null;
  let swLastTs = 0;

  function startSwLoop() {
    stopSwLoop();
    swLastTs = performance.now();
    const tick = (now: number) => {
      if (!swRunning) return;
      swElapsedMs += now - swLastTs;
      swLastTs = now;
      swRaf = requestAnimationFrame(tick);
    };
    swRaf = requestAnimationFrame(tick);
  }

  function stopSwLoop() {
    if (swRaf !== null) {
      cancelAnimationFrame(swRaf);
      swRaf = null;
    }
  }

  function toggleStopwatch() {
    swRunning = !swRunning;
    if (swRunning) startSwLoop();
    else stopSwLoop();
  }

  function resetStopwatch() {
    stopSwLoop();
    swRunning = false;
    swElapsedMs = 0;
    swLaps = [];
  }

  function lapStopwatch() {
    if (!swRunning && swElapsedMs === 0) return;
    swLaps = [swElapsedMs, ...swLaps].slice(0, 50);
  }

  // ── Magic 8 Ball ────────────────────────────────────────
  let eightAnswer = $state<string | null>(null);
  let eightShaking = $state(false);
  let eightReveal = $state(false);
  let eightShakeTimer: ReturnType<typeof setTimeout> | null = null;
  let eightRevealTimer: ReturnType<typeof setTimeout> | null = null;

  function clearEightTimers() {
    if (eightShakeTimer != null) {
      clearTimeout(eightShakeTimer);
      eightShakeTimer = null;
    }
    if (eightRevealTimer != null) {
      clearTimeout(eightRevealTimer);
      eightRevealTimer = null;
    }
  }

  function askMagic8Ball() {
    if (eightShaking) return;
    clearEightTimers();
    eightReveal = false;
    eightAnswer = null;
    eightShaking = true;

    eightShakeTimer = setTimeout(() => {
      eightShaking = false;
      eightAnswer = pickMagic8BallAnswer();
      // Next frame so the wipe transition runs from hidden → shown
      eightRevealTimer = setTimeout(() => {
        eightReveal = true;
        eightRevealTimer = null;
      }, 16);
      eightShakeTimer = null;
    }, MAGIC_8_BALL_SHAKE_MS);
  }

  // ── Scratch Pad ─────────────────────────────────────────
  let padEl = $state<HTMLDivElement | null>(null);
  let padReady = $state(false);

  function persistPad() {
    if (!padEl) return;
    saveScratchPadHtml(padEl.innerHTML);
  }

  const ALLOWED_COMMANDS = new Set([
    "bold",
    "italic",
    "underline",
    "insertUnorderedList",
    "insertOrderedList"
  ]);

  function padCommand(cmd: string, value?: string) {
    if (!ALLOWED_COMMANDS.has(cmd)) return;

    padEl?.focus();
    try {
      document.execCommand(cmd, false, value);
    } catch {
      /* older webviews */
    }
    persistPad();
  }

  function onPadInput() {
    persistPad();
  }

  function onPadPaste(e: ClipboardEvent) {
    e.preventDefault();
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const htmlData = clipboardData.getData("text/html");
    const plainText = clipboardData.getData("text/plain");

    if (htmlData && htmlData.trim()) {
      const cleanHtml = stripFontStylesFromHtml(htmlData);
      document.execCommand("insertHTML", false, cleanHtml);
    } else if (plainText) {
      document.execCommand("insertText", false, plainText);
    }
    persistPad();
  }

  function clearPad() {
    if (!padEl) return;
    padEl.innerHTML = "";
    persistPad();
    padEl.focus();
  }

  // ── Window chrome ───────────────────────────────────────
  async function closeWindow() {
    try {
      await getCurrentWindow().close();
    } catch {
      // Browser / non-Tauri fallback
      window.close();
    }
  }

  /** Frameless + reveal after first paint (avoids OS chrome / blank flash). */
  async function revealToolsWindow() {
    try {
      const win = getCurrentWindow();
      await win.setDecorations(false);
      await win.setAlwaysOnTop(true);
      // Double-rAF: wait until layout + CSS have applied
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
      await win.show();
      await win.setFocus();
    } catch {
      /* non-Tauri / browser preview */
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Ignore Escape while typing in an input (timer edit fields handle their own)
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) {
      // Scratch pad / fields: allow Esc to still close the widget
      if (e.key === "Escape") {
        e.preventDefault();
        closeWindow();
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closeWindow();
      return;
    }

    if (mode === "magic8ball" && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      askMagic8Ball();
      return;
    }

    if (mode !== "calculator") return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      void onCalcPaste();
      return;
    }

    if (e.key === "Enter" || e.key === "=") {
      e.preventDefault();
      onCalcEquals();
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      onCalcBack();
      return;
    }
    if (e.key === "Escape") return;
    if (e.key === "Delete" || e.key.toLowerCase() === "c") {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onCalcClear();
      }
      return;
    }
    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault();
      onCalcDigit(e.key);
      return;
    }
    if (e.key === ".") {
      e.preventDefault();
      onCalcDigit(".");
      return;
    }
    if (e.key === "+" || e.key === "-" || e.key === "*" || e.key === "/") {
      e.preventDefault();
      onCalcOp(e.key);
      return;
    }
  }

  function modeTitle(m: ToolsMode): string {
    switch (m) {
      case "calculator":
        return "Calculator";
      case "timer":
        return "Timer";
      case "stopwatch":
        return "Stopwatch";
      case "magic8ball":
        return "Magic 8 Ball";
      case "scratchpad":
        return "Scratch Pad";
    }
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get("mode");
    if (
      m === "timer" ||
      m === "stopwatch" ||
      m === "calculator" ||
      m === "magic8ball" ||
      m === "scratchpad"
    ) {
      mode = m;
    }
    document.title = modeTitle(mode);
    void revealToolsWindow();
  });

  // Hydrate scratch pad once the contenteditable node mounts
  $effect(() => {
    if (mode !== "scratchpad" || !padEl || padReady) return;
    padEl.innerHTML = loadScratchPadHtml();
    padReady = true;
    // Focus after layout so caret is visible
    requestAnimationFrame(() => padEl?.focus());
  });

  onDestroy(() => {
    stopTimerLoop();
    stopSwLoop();
    clearEightTimers();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="h-screen w-screen flex flex-col font-sans select-none overflow-hidden"
  style="background: var(--sdf-bg-app); color: var(--sdf-text-primary);"
>
  <!-- Frameless custom title bar (drag region + close) -->
  <header
    class="flex items-center justify-between pl-3 pr-1 py-1.5 border-b shrink-0"
    style="background: var(--sdf-bg-chrome); border-color: var(--sdf-border);"
    data-tauri-drag-region
  >
    <span
      class="text-xs font-semibold tracking-wide uppercase pointer-events-none"
      style="color: var(--sdf-text-secondary);"
      data-tauri-drag-region
    >
      {modeTitle(mode)}
    </span>
    <button
      type="button"
      onclick={closeWindow}
      class="w-9 h-7 flex items-center justify-center rounded-sm hover:bg-red-600 hover:text-white transition-colors text-sm no-drag"
      style="color: var(--sdf-text-secondary);"
      title="Close (Esc)"
      aria-label="Close"
    >
      ✕
    </button>
  </header>

  <main
    class="flex-1 min-h-0 flex flex-col {mode === 'timer' || mode === 'magic8ball'
      ? 'px-3 pt-2 pb-2'
      : mode === 'scratchpad'
        ? 'p-0'
        : 'p-3'}"
  >
    {#if mode === "calculator"}
      <!-- Windows-style calculator (dim expression memory above the main line) -->
      <div
        class="mb-3 px-3 py-2.5 border rounded text-right font-mono tracking-tight tabular-nums min-h-[3.75rem] flex flex-col items-end justify-end overflow-hidden gap-0.5"
        style="background: var(--sdf-bg-surface); border-color: var(--sdf-border);"
        aria-live="polite"
      >
        <span
          class="w-full truncate text-xs leading-tight min-h-[1rem]
            {calc.expression ? '' : 'text-transparent'}" style="color: var(--sdf-text-muted);"
          aria-hidden={!calc.expression}
        >
          {calc.expression || "\u00a0"}
        </span>
        <span
          class="truncate w-full text-3xl leading-none
            {calc.error ? 'text-red-400' : ''}" style="{calc.error ? '' : 'color: var(--sdf-text-primary);'}"
        >
          {calc.display}
        </span>
      </div>

      <!-- Windows-style standard calculator pad -->
      <div class="grid grid-cols-4 gap-1.5 flex-1 min-h-0 auto-rows-fr">
        <button type="button" class="calc-btn calc-fn" onclick={onCalcPercent}>%</button>
        <button type="button" class="calc-btn calc-fn" onclick={onCalcCE}>CE</button>
        <button type="button" class="calc-btn calc-fn" onclick={onCalcClear}>C</button>
        <button type="button" class="calc-btn calc-fn" onclick={onCalcBack}>⌫</button>

        <button type="button" class="calc-btn calc-num" onclick={() => onCalcDigit("7")}>7</button>
        <button type="button" class="calc-btn calc-num" onclick={() => onCalcDigit("8")}>8</button>
        <button type="button" class="calc-btn calc-num" onclick={() => onCalcDigit("9")}>9</button>
        <button type="button" class="calc-btn calc-op" onclick={() => onCalcOp("/")}>÷</button>

        <button type="button" class="calc-btn calc-num" onclick={() => onCalcDigit("4")}>4</button>
        <button type="button" class="calc-btn calc-num" onclick={() => onCalcDigit("5")}>5</button>
        <button type="button" class="calc-btn calc-num" onclick={() => onCalcDigit("6")}>6</button>
        <button type="button" class="calc-btn calc-op" onclick={() => onCalcOp("*")}>×</button>

        <button type="button" class="calc-btn calc-num" onclick={() => onCalcDigit("1")}>1</button>
        <button type="button" class="calc-btn calc-num" onclick={() => onCalcDigit("2")}>2</button>
        <button type="button" class="calc-btn calc-num" onclick={() => onCalcDigit("3")}>3</button>
        <button type="button" class="calc-btn calc-op" onclick={() => onCalcOp("-")}>−</button>

        <button type="button" class="calc-btn calc-fn" onclick={onCalcSign}>±</button>
        <button type="button" class="calc-btn calc-num" onclick={() => onCalcDigit("0")}>0</button>
        <button type="button" class="calc-btn calc-num" onclick={() => onCalcDigit(".")}>.</button>
        <button type="button" class="calc-btn calc-op" onclick={() => onCalcOp("+")}>+</button>
      </div>
      <button
        type="button"
        class="calc-btn calc-eq mt-1.5 w-full !min-h-[2.75rem] shrink-0"
        onclick={onCalcEquals}
      >
        =
      </button>

      <p class="mt-2 text-[10px] text-center" style="color: var(--sdf-text-muted);">
        Ctrl+V paste · Esc close
      </p>
    {:else if mode === "timer"}
      <!-- Compact column: stacked tightly (no flex-grow gap) -->
      <div class="flex flex-col items-center gap-2.5">
        {#if timerRunning}
          <div
            class="font-mono text-4xl tabular-nums tracking-tight pt-1"
            style="color: var(--sdf-accent);"
            aria-live="polite"
          >
            {formatCountdown(timerRemainingMs)}
          </div>
        {:else}
          <!-- Editable H : MM : SS when stopped -->
          <div
            class="flex items-end justify-center gap-1"
            style="color: {timerDone ? '#f87171' : 'var(--sdf-text-primary)'};"
          >
            <label class="flex flex-col items-center gap-0.5">
              <span class="text-[9px] uppercase tracking-wider" style="color: var(--sdf-text-muted);">Hrs</span>
              <input
                type="text"
                inputmode="numeric"
                maxlength="2"
                bind:value={editHours}
                onblur={applyEditableTime}
                onkeydown={onEditTimeKeydown}
                class="timer-edit w-11"
                aria-label="Hours"
              />
            </label>
            <span class="font-mono text-2xl pb-1" style="color: var(--sdf-text-muted);">:</span>
            <label class="flex flex-col items-center gap-0.5">
              <span class="text-[9px] uppercase tracking-wider" style="color: var(--sdf-text-muted);">Min</span>
              <input
                type="text"
                inputmode="numeric"
                maxlength="2"
                bind:value={editMinutes}
                onblur={applyEditableTime}
                onkeydown={onEditTimeKeydown}
                class="timer-edit w-11"
                aria-label="Minutes"
              />
            </label>
            <span class="font-mono text-2xl pb-1" style="color: var(--sdf-text-muted);">:</span>
            <label class="flex flex-col items-center gap-0.5">
              <span class="text-[9px] uppercase tracking-wider" style="color: var(--sdf-text-muted);">Sec</span>
              <input
                type="text"
                inputmode="numeric"
                maxlength="2"
                bind:value={editSeconds}
                onblur={applyEditableTime}
                onkeydown={onEditTimeKeydown}
                class="timer-edit w-11"
                aria-label="Seconds"
              />
            </label>
          </div>
          {#if timerDone}
            <p class="text-[10px] text-red-400 font-semibold uppercase tracking-wider -mt-1">
              Time's up
            </p>
          {/if}
        {/if}

        <div class="flex flex-wrap gap-1.5 justify-center">
          {#each PRESETS_MIN as mins}
            <button
              type="button"
              onclick={() => setTimerPreset(mins)}
              disabled={timerRunning}
              class="px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={timerInitialMs === mins * 60 * 1000 && !timerRunning
                ? 'background: var(--sdf-accent-bg); border-color: var(--sdf-accent-border); color: var(--sdf-accent);'
                : 'background: var(--sdf-hover-bg); border-color: var(--sdf-border); color: var(--sdf-text-secondary);'}
            >
              {mins} min
            </button>
          {/each}
        </div>

        <div class="flex gap-2">
          <button
            type="button"
            onclick={toggleTimer}
            class="px-5 py-1.5 rounded-lg text-sm font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors min-w-[5.5rem]"
          >
            {timerRunning ? "Pause" : timerDone ? "Restart" : "Start"}
          </button>
          <button
            type="button"
            onclick={resetTimer}
            class="px-5 py-1.5 rounded-lg text-sm font-bold transition-colors min-w-[5.5rem]"
            style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary);"
          >
            Reset
          </button>
        </div>
      </div>
    {:else if mode === "stopwatch"}
      <!-- Stopwatch -->
      <div class="flex-1 flex flex-col min-h-0">
        <div class="flex flex-col items-center justify-center gap-3 py-3 shrink-0">
          <div
            class="font-mono text-4xl tabular-nums tracking-tight"
            style="color: {swRunning ? '#10b981' : 'var(--sdf-text-primary)'};"
            aria-live="polite"
          >
            {formatStopwatch(swElapsedMs)}
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              onclick={toggleStopwatch}
              class="px-5 py-2 rounded-lg text-sm font-bold text-white transition-colors min-w-[5.5rem]
                {swRunning
                ? 'bg-orange-600 hover:bg-orange-500'
                : 'bg-emerald-600 hover:bg-emerald-500'}"
            >
              {swRunning ? "Stop" : "Start"}
            </button>
            <button
              type="button"
              onclick={lapStopwatch}
              disabled={!swRunning && swElapsedMs === 0}
              class="px-5 py-2 rounded-lg text-sm font-bold bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors min-w-[5.5rem]"
            >
              Lap
            </button>
            <button
              type="button"
              onclick={resetStopwatch}
              class="px-5 py-2 rounded-lg text-sm font-bold transition-colors min-w-[5.5rem]"
            style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary);"
            >
              Reset
            </button>
          </div>
        </div>

        <div
          class="flex-1 min-h-0 overflow-y-auto rounded-lg border"
          style="background: var(--sdf-bg-surface); border-color: var(--sdf-border);"
        >
          {#if swLaps.length === 0}
            <p class="text-center text-xs py-6" style="color: var(--sdf-text-muted);">No laps yet</p>
          {:else}
            <ul class="divide-y text-sm font-mono" style="--tw-divide-opacity:1;" >
              {#each swLaps as lap, i}
                <li class="flex justify-between px-3 py-1.5" style="color: var(--sdf-text-secondary); border-color: var(--sdf-border-subtle);">
                  <span style="color: var(--sdf-text-muted);">Lap {swLaps.length - i}</span>
                  <span class="tabular-nums">{formatStopwatch(lap)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    {:else if mode === "magic8ball"}
      <!-- Magic 8 Ball -->
      <div class="flex-1 flex flex-col items-center justify-center gap-3 min-h-0">
        <p class="text-[11px] uppercase tracking-widest font-semibold" style="color: var(--sdf-text-muted);">
          Ask a yes / no question
        </p>

        <button
          type="button"
          class="eight-ball-hit no-drag border-0 bg-transparent p-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 rounded-full
            {eightShaking ? 'eight-ball-shaking' : ''}"
          onclick={askMagic8Ball}
          disabled={eightShaking}
          aria-label={eightShaking ? "Shaking…" : "Ask the Magic 8 Ball"}
          title={eightShaking ? "Shaking…" : "Click to ask"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 200 200"
            width="200"
            height="200"
            class="drop-shadow-[0_12px_28px_rgba(0,0,0,0.55)]"
            aria-hidden="true"
          >
            <defs>
              <radialGradient id="ballBody" cx="35%" cy="30%" r="70%">
                <stop offset="0%" stop-color="#3f3f46" />
                <stop offset="45%" stop-color="#18181b" />
                <stop offset="100%" stop-color="#09090b" />
              </radialGradient>
              <radialGradient id="ballWindow" cx="40%" cy="35%" r="65%">
                <stop offset="0%" stop-color="#38bdf8" />
                <stop offset="55%" stop-color="#0369a1" />
                <stop offset="100%" stop-color="#0c4a6e" />
              </radialGradient>
              <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <!-- Outer ball -->
            <circle cx="100" cy="100" r="92" fill="url(#ballBody)" />
            <circle
              cx="100"
              cy="100"
              r="92"
              fill="none"
              stroke="#52525b"
              stroke-width="1.5"
              opacity="0.5"
            />
            <!-- Specular highlight -->
            <ellipse
              cx="72"
              cy="62"
              rx="28"
              ry="16"
              fill="white"
              opacity="0.12"
            />

            <!-- Blue answer window -->
            <circle cx="100" cy="100" r="42" fill="url(#ballWindow)" filter="url(#softGlow)" />
            <circle
              cx="100"
              cy="100"
              r="42"
              fill="none"
              stroke="#7dd3fc"
              stroke-width="1.25"
              opacity="0.35"
            />

            <!-- White triangle (answer face) -->
            <polygon
              points="100,68 132,128 68,128"
              fill="#f8fafc"
              opacity="0.95"
            />

            {#if eightAnswer && eightReveal}
              <foreignObject x="72" y="88" width="56" height="40">
                <div
                  xmlns="http://www.w3.org/1999/xhtml"
                  class="eight-answer-text eight-answer-show"
                >
                  {eightAnswer}
                </div>
              </foreignObject>
            {:else if eightAnswer && !eightReveal}
              <foreignObject x="72" y="88" width="56" height="40">
                <div
                  xmlns="http://www.w3.org/1999/xhtml"
                  class="eight-answer-text"
                >
                  {eightAnswer}
                </div>
              </foreignObject>
            {:else if !eightShaking}
              <!-- Idle: big 8 -->
              <text
                x="100"
                y="112"
                text-anchor="middle"
                font-family="system-ui, Segoe UI, sans-serif"
                font-size="36"
                font-weight="800"
                fill="#0f172a"
              >8</text>
            {/if}
          </svg>
        </button>

        <button
          type="button"
          onclick={askMagic8Ball}
          disabled={eightShaking}
          class="px-6 py-2 rounded-lg text-sm font-bold text-white transition-colors min-w-[7rem]
            disabled:opacity-50 disabled:cursor-not-allowed
            bg-indigo-600 hover:bg-indigo-500"
        >
          {eightShaking ? "Shaking…" : eightAnswer ? "Ask again" : "Ask"}
        </button>

        <p
          class="text-center text-sm min-h-[2.5rem] px-3 leading-snug font-semibold
            {eightReveal ? 'eight-caption-show' : ''}"
          style="color: {eightReveal ? 'var(--sdf-accent)' : 'var(--sdf-text-muted)'};"
          aria-live="polite"
        >
          {#if eightShaking}
            Consulting the spirits…
          {:else if eightAnswer && eightReveal}
            {eightAnswer}
          {:else}
            Click the ball or Ask
          {/if}
        </p>
      </div>
    {:else if mode === "scratchpad"}
      <!-- Scratch Pad — early-iOS-Notes feel, black pad / white text -->
      <div class="flex-1 min-h-0 flex flex-col" style="background: var(--sdf-bg-app);">
        <div
          class="flex items-center gap-0.5 px-2 py-1.5 border-b shrink-0 no-drag"
          style="background: var(--sdf-bg-surface); border-color: var(--sdf-border-subtle);"
          role="toolbar"
          aria-label="Formatting"
        >
          <button
            type="button"
            class="pad-fmt-btn"
            title="Bold"
            aria-label="Bold"
            onclick={() => padCommand("bold")}
          >
            <span class="font-bold">B</span>
          </button>
          <button
            type="button"
            class="pad-fmt-btn"
            title="Italic"
            aria-label="Italic"
            onclick={() => padCommand("italic")}
          >
            <span class="italic font-serif">I</span>
          </button>
          <button
            type="button"
            class="pad-fmt-btn"
            title="Underline"
            aria-label="Underline"
            onclick={() => padCommand("underline")}
          >
            <span class="underline">U</span>
          </button>
          <span class="w-px h-4 mx-1" style="background: var(--sdf-border-subtle);" aria-hidden="true"></span>
          <button
            type="button"
            class="pad-fmt-btn"
            title="Bulleted list"
            aria-label="Bulleted list"
            onclick={() => padCommand("insertUnorderedList")}
          >
            <!-- list icon -->
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="9" x2="20" y1="6" y2="6" /><line x1="9" x2="20" y1="12" y2="12" /><line x1="9" x2="20" y1="18" y2="18" />
              <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button
            type="button"
            class="pad-fmt-btn"
            title="Numbered list"
            aria-label="Numbered list"
            onclick={() => padCommand("insertOrderedList")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="10" x2="20" y1="6" y2="6" /><line x1="10" x2="20" y1="12" y2="12" /><line x1="10" x2="20" y1="18" y2="18" />
              <path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
            </svg>
          </button>
          <span class="flex-1"></span>
          <button
            type="button"
            class="pad-fmt-btn text-[10px] tracking-wide uppercase hover:text-red-300" style="color: var(--sdf-text-muted);"
            title="Clear pad"
            aria-label="Clear pad"
            onclick={clearPad}
          >
            Clear
          </button>
        </div>

        <div
          bind:this={padEl}
          class="scratch-pad flex-1 min-h-0 overflow-y-auto px-4 py-3 outline-none no-drag"
          style="color: var(--sdf-text-primary);"
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          aria-label="Scratch pad notes"
          data-placeholder="Start typing…"
          oninput={onPadInput}
          onpaste={onPadPaste}
          onblur={persistPad}
        ></div>
      </div>
    {/if}
  </main>
</div>

<style>
  .calc-btn {
    border-radius: 0.35rem;
    font-size: 1rem;
    font-weight: 500;
    border: 1px solid transparent;
    cursor: pointer;
    transition: background-color 0.1s ease, border-color 0.1s ease;
    min-height: 2.5rem;
  }
  .calc-num {
    background: var(--sdf-hover-bg);
    color: var(--sdf-text-primary);
  }
  .calc-num:hover {
    background: var(--sdf-active-bg);
  }
  .calc-fn {
    background: var(--sdf-bg-surface);
    color: var(--sdf-text-primary);
  }
  .calc-fn:hover {
    background: var(--sdf-hover-bg);
  }
  .calc-op {
    background: var(--sdf-bg-chrome);
    color: var(--sdf-accent-text);
    border-color: var(--sdf-border);
  }
  .calc-op:hover {
    background: var(--sdf-hover-bg);
  }
  .calc-eq {
    background: #0891b2;
    color: white;
    font-weight: 700;
  }
  .calc-eq:hover {
    background: #06b6d4;
  }
  .timer-edit {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 1.65rem;
    line-height: 1.1;
    text-align: center;
    background: var(--sdf-bg-surface);
    border: 1px solid var(--sdf-border);
    border-radius: 0.4rem;
    color: inherit;
    padding: 0.25rem 0.1rem;
    outline: none;
  }
  .timer-edit:focus {
    border-color: #22d3ee;
    box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.35);
  }

  /* Scratch Pad — early-iOS-Notes feel */
  .pad-fmt-btn {
    width: 1.85rem;
    height: 1.85rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 0.35rem;
    background: transparent;
    color: var(--sdf-text-secondary);
    cursor: pointer;
    transition: background-color 0.1s ease, color 0.1s ease;
  }
  .pad-fmt-btn:hover {
    background: var(--sdf-hover-bg);
    color: var(--sdf-text-primary);
  }
  .scratch-pad {
    font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif;
    font-size: 15px;
    line-height: 1.55;
    letter-spacing: 0.01em;
    caret-color: var(--sdf-text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    user-select: text;
    -webkit-user-select: text;
  }
  .scratch-pad:empty::before {
    content: attr(data-placeholder);
    color: var(--sdf-text-muted);
    pointer-events: none;
  }
  .scratch-pad :global(ul),
  .scratch-pad :global(ol) {
    margin: 0.25rem 0 0.25rem 1.25rem;
    padding: 0;
  }
  .scratch-pad :global(li) {
    margin: 0.1rem 0;
  }
  .scratch-pad :global(b),
  .scratch-pad :global(strong) {
    font-weight: 700;
  }
  .scratch-pad :global(i),
  .scratch-pad :global(em) {
    font-style: italic;
  }
  .scratch-pad :global(u) {
    text-decoration: underline;
  }
  /* Keep close / controls clickable over drag region (WebView2) */
  .no-drag {
    -webkit-app-region: no-drag;
  }

  /* ── Magic 8 Ball ─────────────────────────────────────── */
  .eight-ball-shaking {
    animation: eight-shake 0.9s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
  }

  @keyframes eight-shake {
    0%,
    100% {
      transform: translate3d(0, 0, 0) rotate(0deg);
    }
    10% {
      transform: translate3d(-7px, 2px, 0) rotate(-6deg);
    }
    20% {
      transform: translate3d(8px, -3px, 0) rotate(5deg);
    }
    30% {
      transform: translate3d(-9px, 1px, 0) rotate(-7deg);
    }
    40% {
      transform: translate3d(7px, 3px, 0) rotate(6deg);
    }
    50% {
      transform: translate3d(-6px, -2px, 0) rotate(-4deg);
    }
    60% {
      transform: translate3d(8px, 2px, 0) rotate(5deg);
    }
    70% {
      transform: translate3d(-5px, -1px, 0) rotate(-3deg);
    }
    80% {
      transform: translate3d(4px, 1px, 0) rotate(2deg);
    }
    90% {
      transform: translate3d(-2px, 0, 0) rotate(-1deg);
    }
  }

  /* Answer text inside the triangle (foreignObject HTML) */
  .eight-answer-text {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    box-sizing: border-box;
    padding: 2px 3px;
    text-align: center;
    font-family: system-ui, Segoe UI, sans-serif;
    font-size: 7.5px;
    font-weight: 700;
    line-height: 1.15;
    color: #0c4a6e;
    opacity: 0;
    clip-path: inset(0 0 100% 0);
    transition:
      opacity 0.45s ease,
      clip-path 0.45s ease;
  }

  .eight-answer-show {
    opacity: 1;
    clip-path: inset(0 0 0 0);
  }

  .eight-caption-show {
    animation: eight-caption-in 0.45s ease both;
  }

  @keyframes eight-caption-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
