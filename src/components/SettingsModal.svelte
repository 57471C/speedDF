<script lang="ts">
  import {
    type AppSettings,
    type ToolId,
    TOOL_IDS,
    TOOL_LABELS,
  } from "../lib/settings/appSettings";
  import {
    createSettingsDraft,
    saveAppSettings,
  } from "../lib/settings/appSettings.svelte";
  import {
    listAllFormMemory,
    removeFormValue,
    replaceFormMemoryValue,
  } from "../lib/forms/formMemory.svelte";

  let {
    show = $bindable(false),
  }: {
    show: boolean;
  } = $props();

  /** Working copy — discarded on close without save. */
  let draft = $state<AppSettings>(createSettingsDraft());
  let view = $state<"main" | "saved">("main");
  let editingValue = $state<string | null>(null);
  let editDraft = $state("");

  // Reset draft when modal opens
  $effect(() => {
    if (show) {
      draft = createSettingsDraft();
      view = "main";
      editingValue = null;
      editDraft = "";
    }
  });

  let memoryRows = $derived(listAllFormMemory());

  function closeWithoutSave() {
    show = false;
    view = "main";
    editingValue = null;
  }

  function saveAndClose() {
    saveAppSettings(draft);
    show = false;
    view = "main";
    editingValue = null;
  }

  function toggleTool(id: ToolId) {
    draft = {
      ...draft,
      tools: { ...draft.tools, [id]: !draft.tools[id] },
    };
  }

  function startEdit(value: string) {
    editingValue = value;
    editDraft = value;
  }

  function commitEdit() {
    if (editingValue == null) return;
    const next = editDraft.trim();
    if (!next) {
      removeFormValue(editingValue);
    } else if (next !== editingValue) {
      replaceFormMemoryValue(editingValue, next);
    }
    editingValue = null;
    editDraft = "";
  }

  function cancelEdit() {
    editingValue = null;
    editDraft = "";
  }

  function deleteValue(value: string) {
    removeFormValue(value);
    if (editingValue === value) cancelEdit();
  }

  function keyLabel(key: string): string {
    if (key === "global") return "Global";
    if (key === "annotation:text") return "Text notes";
    if (key === "form:text") return "Form text";
    if (key.startsWith("form:field:")) return key.slice("form:field:".length);
    return key;
  }
</script>

{#if show}
  <div
    class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[999] flex items-center justify-center p-6 font-sans select-none"
    role="presentation"
    onclick={closeWithoutSave}
  >
    <div
      class="bg-[#0b101c] border border-slate-800 w-full max-w-lg max-h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden text-slate-300"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div
        class="p-4 border-b border-slate-900/60 flex items-center justify-between bg-[#0e1524]/60 shrink-0"
      >
        <div class="flex items-center gap-2">
          {#if view === "saved"}
            <button
              type="button"
              class="text-slate-500 hover:text-white text-xs font-bold uppercase tracking-wider mr-1"
              onclick={() => (view = "main")}
            >
              ← Back
            </button>
          {/if}
          <span class="text-xs font-bold uppercase tracking-widest text-slate-400">
            {view === "saved" ? "Saved Values" : "Settings"}
          </span>
        </div>
        <button
          type="button"
          onclick={closeWithoutSave}
          class="text-slate-500 hover:text-white text-sm transition-colors"
          title="Close without saving"
          aria-label="Close without saving"
        >✕</button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 space-y-6 text-xs leading-relaxed">
        {#if view === "main"}
          <!-- Theme -->
          <section>
            <h4 class="text-[11px] font-bold uppercase tracking-widest text-slate-100 mb-2.5">
              Theme
            </h4>
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 py-2 rounded-lg border text-[11px] font-semibold transition-colors
                  {draft.theme === 'dark'
                    ? 'border-cyan-500/60 bg-cyan-950/30 text-cyan-300'
                    : 'border-slate-800 bg-slate-950/40 text-slate-400'}"
                onclick={() => (draft = { ...draft, theme: "dark" })}
              >
                Dark
              </button>
              <button
                type="button"
                class="settings-coming-soon flex-1 py-2 rounded-lg border border-slate-800/80 bg-slate-950/20 text-slate-600 text-[11px] font-semibold opacity-60"
                title="Coming soon"
                aria-disabled="true"
                tabindex="-1"
              >
                Light
              </button>
            </div>
          </section>

          <!-- Tools -->
          <section>
            <h4 class="text-[11px] font-bold uppercase tracking-widest text-slate-100 mb-2.5">
              Tools
            </h4>
            <p class="text-[10px] text-slate-500 mb-2">
              Turn tools off to hide them from the right-click menu.
            </p>
            <div class="space-y-1.5">
              {#each TOOL_IDS as id}
                <label
                  class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-900 bg-slate-950/40 cursor-pointer hover:border-slate-800"
                >
                  <span class="text-[12px] text-slate-200 font-medium">
                    {TOOL_LABELS[id]}
                  </span>
                  <input
                    type="checkbox"
                    class="settings-toggle"
                    checked={draft.tools[id]}
                    onchange={() => toggleTool(id)}
                  />
                </label>
              {/each}
            </div>
          </section>

          <!-- Network features -->
          <section>
            <h4 class="text-[11px] font-bold uppercase tracking-widest text-slate-100 mb-1">
              Network features
            </h4>
            <p class="text-[10px] text-slate-500 mb-2">
              These features need an internet connection. When off, using them shows a toast to enable here.
            </p>
            <div class="space-y-1.5">
              <label
                class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-900 bg-slate-950/40 cursor-pointer hover:border-slate-800"
              >
                <div>
                  <div class="text-[12px] text-slate-200 font-medium">OCR</div>
                  <div class="text-[10px] text-slate-500">Downloads models on first use</div>
                </div>
                <input
                  type="checkbox"
                  class="settings-toggle"
                  checked={draft.ocr}
                  onchange={() => (draft = { ...draft, ocr: !draft.ocr })}
                />
              </label>
              <div
                class="settings-coming-soon flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-900 bg-slate-950/30 opacity-55"
                title="Coming soon"
                aria-disabled="true"
              >
                <div>
                  <div class="text-[12px] text-slate-400 font-medium">Look Up dictionary</div>
                  <div class="text-[10px] text-slate-600">Online word lookup for selections</div>
                </div>
                <!-- Non-interactive toggle (coming soon) — no not-allowed cursor -->
                <span
                  class="settings-toggle settings-toggle--off"
                  role="presentation"
                  title="Coming soon"
                ></span>
              </div>
              <label
                class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-900 bg-slate-950/40 cursor-pointer hover:border-slate-800"
              >
                <div>
                  <div class="text-[12px] text-slate-200 font-medium">
                    Check for updates on launch
                  </div>
                  <div class="text-[10px] text-slate-500">Silent background update check</div>
                </div>
                <input
                  type="checkbox"
                  class="settings-toggle"
                  checked={draft.checkUpdatesOnLaunch}
                  onchange={() =>
                    (draft = {
                      ...draft,
                      checkUpdatesOnLaunch: !draft.checkUpdatesOnLaunch,
                    })}
                />
              </label>
            </div>
          </section>

          <!-- Saved values -->
          <section>
            <h4 class="text-[11px] font-bold uppercase tracking-widest text-slate-100 mb-2.5">
              Saved Values
            </h4>
            <button
              type="button"
              class="w-full py-2 px-3 rounded-lg border border-slate-800 bg-slate-950/50 text-[11px] font-semibold text-slate-200 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors"
              onclick={() => (view = "saved")}
            >
              Show saved values
              <span class="text-slate-500 font-normal ml-1">
                ({memoryRows.length})
              </span>
            </button>
          </section>
        {:else}
          <!-- Saved values table -->
          {#if memoryRows.length === 0}
            <p class="text-slate-500 text-center py-8 text-[11px]">
              No remembered values yet. Use ★ Remember while typing in forms or text notes.
            </p>
          {:else}
            <div class="border border-slate-900 rounded-lg overflow-hidden">
              <table class="w-full text-left text-[11px]">
                <thead class="bg-slate-950/80 text-slate-500 uppercase tracking-wider text-[9px]">
                  <tr>
                    <th class="px-3 py-2 font-semibold">Value</th>
                    <th class="px-2 py-2 font-semibold w-20 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-900/80">
                  {#each memoryRows as row (row.value)}
                    <tr class="bg-slate-950/30 hover:bg-slate-900/40">
                      <td class="px-3 py-2 align-top min-w-0">
                        {#if editingValue === row.value}
                          <input
                            type="text"
                            class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-cyan-500"
                            bind:value={editDraft}
                            onkeydown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitEdit();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEdit();
                              }
                            }}
                          />
                          <div class="flex gap-1 mt-1">
                            <button
                              type="button"
                              class="text-[9px] text-emerald-400 hover:text-emerald-300 font-bold uppercase"
                              onclick={commitEdit}
                            >Save</button>
                            <button
                              type="button"
                              class="text-[9px] text-slate-500 hover:text-slate-300 font-bold uppercase"
                              onclick={cancelEdit}
                            >Cancel</button>
                          </div>
                        {:else}
                          <div class="text-slate-200 break-words font-medium">
                            {row.value}
                          </div>
                          <div class="text-[9px] text-slate-600 mt-0.5 truncate" title={row.keys.map(keyLabel).join(", ")}>
                            {row.keys.map(keyLabel).join(" · ")}
                          </div>
                        {/if}
                      </td>
                      <td class="px-2 py-2 align-top">
                        <div class="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            class="p-1.5 rounded text-slate-500 hover:text-amber-400 hover:bg-slate-800"
                            title="Edit"
                            aria-label="Edit value"
                            onclick={() => startEdit(row.value)}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                          </button>
                          <button
                            type="button"
                            class="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800"
                            title="Delete"
                            aria-label="Delete value"
                            onclick={() => deleteValue(row.value)}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {/if}
      </div>

      <!-- Footer -->
      <div
        class="p-3 border-t border-slate-900/60 flex items-center justify-end gap-2 bg-[#0e1524]/40 shrink-0"
      >
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-400 hover:text-white border border-slate-800 hover:border-slate-600 transition-colors"
          onclick={closeWithoutSave}
        >
          Close without saving
        </button>
        <button
          type="button"
          class="px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
          onclick={saveAndClose}
        >
          Save
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-toggle {
    appearance: none;
    width: 2.25rem;
    height: 1.2rem;
    border-radius: 999px;
    background: #1e293b;
    border: 1px solid #334155;
    position: relative;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
    flex-shrink: 0;
    display: inline-block;
  }
  .settings-toggle::after {
    content: "";
    position: absolute;
    top: 1px;
    left: 2px;
    width: 0.85rem;
    height: 0.85rem;
    border-radius: 999px;
    background: #94a3b8;
    transition: transform 0.15s ease, background 0.15s ease;
  }
  .settings-toggle:checked {
    background: rgba(8, 145, 178, 0.35);
    border-color: #06b6d4;
  }
  .settings-toggle:checked::after {
    transform: translateX(1rem);
    background: #22d3ee;
  }
  /* Static off state for coming-soon toggles (not an input) */
  .settings-toggle--off {
    cursor: default;
    pointer-events: none;
  }
  /* Greyed-out “coming soon” — no forbidden cursor */
  .settings-coming-soon {
    cursor: default;
  }
  .settings-coming-soon:disabled,
  .settings-coming-soon[aria-disabled="true"] {
    cursor: default;
  }
</style>
