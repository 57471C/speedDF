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

  type ToolsMode = "calculator" | "timer" | "stopwatch";

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
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === "Escape") {
      e.preventDefault();
      closeWindow();
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

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get("mode");
    if (m === "timer" || m === "stopwatch" || m === "calculator") {
      mode = m;
    }
    document.title =
      mode === "calculator"
        ? "Calculator"
        : mode === "timer"
          ? "Timer"
          : "Stopwatch";
    void revealToolsWindow();
  });

  onDestroy(() => {
    stopTimerLoop();
    stopSwLoop();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="h-screen w-screen flex flex-col bg-[#1e1e1e] text-zinc-100 font-sans select-none overflow-hidden"
>
  <!-- Frameless custom title bar (drag region + close) -->
  <header
    class="flex items-center justify-between pl-3 pr-1 py-1.5 bg-[#2d2d2d] border-b border-zinc-700/80 shrink-0"
    data-tauri-drag-region
  >
    <span
      class="text-xs font-semibold tracking-wide text-zinc-300 uppercase pointer-events-none"
      data-tauri-drag-region
    >
      {mode === "calculator"
        ? "Calculator"
        : mode === "timer"
          ? "Timer"
          : "Stopwatch"}
    </span>
    <button
      type="button"
      onclick={closeWindow}
      class="w-9 h-7 flex items-center justify-center rounded-sm hover:bg-red-600 text-zinc-400 hover:text-white transition-colors text-sm no-drag"
      title="Close (Esc)"
      aria-label="Close"
    >
      ✕
    </button>
  </header>

  <main
    class="flex-1 min-h-0 flex flex-col {mode === 'timer'
      ? 'px-3 pt-2 pb-2'
      : 'p-3'}"
  >
    {#if mode === "calculator"}
      <!-- Windows-style calculator -->
      <div
        class="mb-3 px-3 py-3 bg-[#1a1a1a] border border-zinc-700 rounded text-right font-mono text-3xl tracking-tight tabular-nums min-h-[3.25rem] flex items-end justify-end overflow-hidden"
        aria-live="polite"
      >
        <span class="truncate w-full {calc.error ? 'text-red-400' : 'text-white'}">
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

      <p class="mt-2 text-[10px] text-zinc-500 text-center">
        Ctrl+V paste · Esc close
      </p>
    {:else if mode === "timer"}
      <!-- Compact column: stacked tightly (no flex-grow gap) -->
      <div class="flex flex-col items-center gap-2.5">
        {#if timerRunning}
          <div
            class="font-mono text-4xl tabular-nums tracking-tight text-cyan-300 pt-1"
            aria-live="polite"
          >
            {formatCountdown(timerRemainingMs)}
          </div>
        {:else}
          <!-- Editable H : MM : SS when stopped -->
          <div
            class="flex items-end justify-center gap-1 {timerDone
              ? 'text-red-400'
              : 'text-white'}"
          >
            <label class="flex flex-col items-center gap-0.5">
              <span class="text-[9px] uppercase tracking-wider text-zinc-500">Hrs</span>
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
            <span class="font-mono text-2xl pb-1 text-zinc-500">:</span>
            <label class="flex flex-col items-center gap-0.5">
              <span class="text-[9px] uppercase tracking-wider text-zinc-500">Min</span>
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
            <span class="font-mono text-2xl pb-1 text-zinc-500">:</span>
            <label class="flex flex-col items-center gap-0.5">
              <span class="text-[9px] uppercase tracking-wider text-zinc-500">Sec</span>
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
              class="px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                {timerInitialMs === mins * 60 * 1000 && !timerRunning
                ? 'bg-cyan-600/30 border-cyan-500/60 text-cyan-200'
                : 'bg-zinc-800 border-zinc-600 text-zinc-300 hover:bg-zinc-700'}"
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
            class="px-5 py-1.5 rounded-lg text-sm font-bold bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors min-w-[5.5rem]"
          >
            Reset
          </button>
        </div>
      </div>
    {:else}
      <!-- Stopwatch -->
      <div class="flex-1 flex flex-col min-h-0">
        <div class="flex flex-col items-center justify-center gap-3 py-3 shrink-0">
          <div
            class="font-mono text-4xl tabular-nums tracking-tight {swRunning
              ? 'text-emerald-300'
              : 'text-white'}"
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
              class="px-5 py-2 rounded-lg text-sm font-bold bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors min-w-[5.5rem]"
            >
              Reset
            </button>
          </div>
        </div>

        <div
          class="flex-1 min-h-0 overflow-y-auto rounded-lg border border-zinc-700/80 bg-[#151515]"
        >
          {#if swLaps.length === 0}
            <p class="text-center text-xs text-zinc-500 py-6">No laps yet</p>
          {:else}
            <ul class="divide-y divide-zinc-800 text-sm font-mono">
              {#each swLaps as lap, i}
                <li class="flex justify-between px-3 py-1.5 text-zinc-300">
                  <span class="text-zinc-500">Lap {swLaps.length - i}</span>
                  <span class="tabular-nums">{formatStopwatch(lap)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
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
    background: #323232;
    color: #f3f4f6;
  }
  .calc-num:hover {
    background: #3f3f3f;
  }
  .calc-fn {
    background: #2a2a2a;
    color: #e4e4e7;
  }
  .calc-fn:hover {
    background: #383838;
  }
  .calc-op {
    background: #2d2d2d;
    color: #67e8f9;
    border-color: #3f3f46;
  }
  .calc-op:hover {
    background: #3f3f46;
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
    background: #151515;
    border: 1px solid #3f3f46;
    border-radius: 0.4rem;
    color: inherit;
    padding: 0.25rem 0.1rem;
    outline: none;
  }
  .timer-edit:focus {
    border-color: #22d3ee;
    box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.35);
  }
  /* Keep close / controls clickable over drag region (WebView2) */
  .no-drag {
    -webkit-app-region: no-drag;
  }
</style>
