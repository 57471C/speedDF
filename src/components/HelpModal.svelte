<script lang="ts">
  let { show = $bindable(), openCoffeeLink } = $props();
</script>

{#if show}
  <div
    onclick={() => (show = false)}
    class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[999] flex items-center justify-center p-6 font-sans select-none"
  >
    <div
      onclick={(e) => e.stopPropagation()}
      class="border w-full max-w-2xl max-h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden"
      style="background: var(--sdf-bg-chrome); border-color: var(--sdf-border); color: var(--sdf-text-secondary);"
    >
      <div
        class="p-4 border-b flex items-center justify-between shrink-0"
        style="border-color: var(--sdf-border-subtle); background: color-mix(in srgb, var(--sdf-bg-surface) 60%, transparent);"
      >
        <div class="flex items-center gap-2">
          <span
            class="text-xs font-bold uppercase tracking-widest"
            style="color: var(--sdf-text-secondary);"
            >speedDF Engine Configuration & Licensing</span
          >
          <span
            class="text-[10px] px-1.5 py-0.5 rounded font-mono"
            style="background: var(--sdf-hover-bg); color: var(--sdf-text-secondary);"
            >v1.2.4</span
          >
        </div>
        <button
          onclick={() => (show = false)}
          class="text-sm transition-colors"
          style="color: var(--sdf-text-muted);">✕</button
        >
      </div>

      <div class="flex-1 overflow-y-auto p-5 space-y-6 text-xs leading-relaxed">
        <div>
          <h4
            class="font-bold uppercase tracking-wide text-[11px] mb-2.5 flex items-center gap-1.5 text-emerald-400"
          >
            ⌨️ Keyboard Operations Map
          </h4>
          <div
            class="rounded-lg border p-3 grid grid-cols-2 gap-2 font-mono text-[11px]"
            style="background: color-mix(in srgb, var(--sdf-bg-input) 50%, transparent); border-color: var(--sdf-border-subtle);"
          >
            <div class="flex items-center gap-2">
              <kbd
                class="px-1.5 py-0.5 rounded border-b"
                style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary); border-color: var(--sdf-border);"
                >Ctrl + Z</kbd
              > <span>Undo Action Transaction</span>
            </div>
            <div class="flex items-center gap-2">
              <kbd
                class="px-1.5 py-0.5 rounded border-b"
                style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary); border-color: var(--sdf-border);"
                >Ctrl + Y</kbd
              > <span>Redo Action Transaction</span>
            </div>
            <div class="flex items-center gap-2">
              <kbd
                class="px-1.5 py-0.5 rounded border-b"
                style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary); border-color: var(--sdf-border);"
                >Ctrl + ←</kbd
              > <span>Counter-Clockwise Rotation</span>
            </div>
            <div class="flex items-center gap-2">
              <kbd
                class="px-1.5 py-0.5 rounded border-b"
                style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary); border-color: var(--sdf-border);"
                >Ctrl + →</kbd
              > <span>Clockwise Page Rotation</span>
            </div>
            <div class="flex items-center gap-2">
              <kbd
                class="px-1.5 py-0.5 rounded border-b"
                style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary); border-color: var(--sdf-border);"
                >F1</kbd
              > <span>Toggle This System Control Panel</span>
            </div>
            <div class="flex items-center gap-2">
              <kbd
                class="px-1.5 py-0.5 rounded border-b"
                style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary); border-color: var(--sdf-border);"
                >Ctrl + \</kbd
              > <span>Markdown Split / Preview</span>
            </div>
          </div>
        </div>

        <div>
          <h4
            class="font-bold uppercase tracking-wide text-[11px] mb-2.5 flex items-center gap-1.5 text-cyan-400"
            style="color: var(--sdf-accent-text);"
          >
            🌐 Canvas Navigation
          </h4>
          <div
            class="rounded-lg border p-3 grid grid-cols-2 gap-2 font-mono text-[11px]"
            style="background: color-mix(in srgb, var(--sdf-bg-input) 50%, transparent); border-color: var(--sdf-border-subtle);"
          >
            <div class="flex items-center gap-2">
              <span class="flex gap-1">
                <kbd
                  class="px-1.5 py-0.5 rounded border-b"
                  style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary); border-color: var(--sdf-border);"
                  >Spacebar</kbd
                >
                <span class="font-sans" style="color: var(--sdf-text-muted);"
                  >+</span
                >
                <kbd
                  class="px-1.5 py-0.5 rounded border-b"
                  style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary); border-color: var(--sdf-border);"
                  >Drag</kbd
                >
              </span>
              <span>Pan Workspace</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="flex gap-1">
                <kbd
                  class="px-1.5 py-0.5 rounded border-b"
                  style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary); border-color: var(--sdf-border);"
                  >Ctrl</kbd
                >
                <span class="font-sans" style="color: var(--sdf-text-muted);"
                  >+</span
                >
                <kbd
                  class="px-1.5 py-0.5 rounded border-b"
                  style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary); border-color: var(--sdf-border);"
                  >Wheel</kbd
                >
              </span>
              <span>Dynamic Zoom</span>
            </div>
            <div class="flex items-center gap-2">
              <kbd
                class="px-1.5 py-0.5 rounded border-b"
                style="background: var(--sdf-hover-bg); color: var(--sdf-text-primary); border-color: var(--sdf-border);"
                >Ctrl + P</kbd
              > <span>Print Document</span>
            </div>
          </div>
        </div>

        <div>
          <h4
            class="font-bold uppercase tracking-wide text-[11px] mb-2 flex items-center gap-1.5 text-blue-400"
          >
            ⚖️ End-User License Agreement (EULA)
          </h4>
          <div
            class="rounded-lg border p-3 h-28 overflow-y-auto text-[10px] space-y-2 font-mono"
            style="background: color-mix(in srgb, var(--sdf-bg-input) 40%, transparent); border-color: var(--sdf-border-subtle); color: var(--sdf-text-secondary);"
          >
            <p class="font-bold" style="color: var(--sdf-text-primary);">
              1. LICENSE GRANT & RESTRICTIONS
            </p>
            <p>
              speedDF grants you a personal, non-transferable, free utility
              license to process local documents. You may not reverse engineer,
              decompile, or distribute compiled workspace assets commercially
              without express written consent.
            </p>
            <p class="font-bold" style="color: var(--sdf-text-primary);">
              2. NO WARRANTY (AS-IS)
            </p>
            <p>
              THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
              EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
              MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
              NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
              HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
              WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
              OUT OF OR IN CONNECTION WITH THE SOFTWARE.
            </p>
          </div>
        </div>

        <div>
          <h4
            class="font-bold uppercase tracking-wide text-[11px] mb-2 flex items-center gap-1.5 text-amber-500"
          >
            📜 Open Source Compliance & Legal Notices
          </h4>
          <div
            class="rounded-lg border p-3 text-[10px] space-y-3 font-mono"
            style="background: color-mix(in srgb, var(--sdf-bg-input) 40%, transparent); border-color: var(--sdf-border-subtle); color: var(--sdf-text-secondary);"
          >
            <p>
              This software utilizes public open-source libraries. In compliance
              with active licensing terms, the following copyright notices must
              remain hardcoded inside binary distributions:
            </p>
            <div
              class="border-l-2 pl-2.5 space-y-1.5"
              style="border-color: var(--sdf-border);"
            >
              <p>
                • <b style="color: var(--sdf-text-primary);">pdf-lib:</b> Copyright
                (c) 2019 Andrew Chon. Distributed under the MIT License.
              </p>
              <p>
                • <b style="color: var(--sdf-text-primary);">lopdf:</b> Copyright
                (c) 2016-2024 lopdf Developers. Distributed under the MIT License.
              </p>
              <p>
                • <b style="color: var(--sdf-text-primary);">PDF.js:</b> Copyright
                (c) Mozilla Foundation. Distributed under the Apache License 2.0.
              </p>
              <p>
                • <b style="color: var(--sdf-text-primary);">Tauri Engine:</b> Copyright
                (c) 2019-2024 Tauri Programme Collective. Distributed under Apache
                2.0 / MIT.
              </p>
              <p>
                • <b style="color: var(--sdf-text-primary);">heic (imazen):</b> Copyright
                (c) 2024-2026 Imazen LLC. Pure-Rust HEIC/HEIF decoder. Distributed
                under AGPL-3.0-only OR Imazen Commercial License. Optional feature
                — included only in builds compiled with HEIC support enabled.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        class="p-3 border-t flex justify-between items-center"
        style="border-color: var(--sdf-border-subtle); background: color-mix(in srgb, var(--sdf-bg-surface) 40%, transparent);"
      >
        <button
          onclick={openCoffeeLink}
          class="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 font-sans text-[11px] font-bold uppercase tracking-wider text-amber-400 transition-all duration-150 hover:border-amber-500/60 hover:bg-amber-500/20"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M17 8h1a4 4 0 1 1 0 8h-1"></path>
            <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"></path>
            <line x1="6" y1="2" x2="6" y2="4"></line>
            <line x1="10" y1="2" x2="10" y2="4"></line>
            <line x1="14" y1="2" x2="14" y2="4"></line>
          </svg>
          <span>Buy me a coffee</span>
        </button>

        <button
          onclick={() => (show = false)}
          class="px-4 py-1.5 text-white rounded-lg text-[11px] font-bold transition-colors shadow-md"
          style="background: var(--sdf-accent);"
        >
          Acknowledge & Close
        </button>
      </div>
    </div>
  </div>
{/if}
