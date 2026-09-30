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
  import {
    applyPreviewRegistration,
    fetchPreviewRegistration,
    isWindowsPlatform,
    previewIsOn,
    previewStatusLine,
    type PreviewRegistration,
  } from "../lib/preview/previewRegistration";

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
  const previewOnWindows =
    typeof navigator !== "undefined" &&
    isWindowsPlatform(navigator.platform, navigator.userAgent);

  // Reset draft when modal opens
  $effect(() => {
    if (show) {
      draft = createSettingsDraft();
      view = "main";
      editingValue = null;
      editDraft = "";
      previewMessage = "";
      if (previewOnWindows) void refreshPreview();
    }
  });

  let memoryRows = $derived(listAllFormMemory());
  let previewStatus = $state<PreviewRegistration | null>(null);
  let previewBusy = $state(false);
  let previewMessage = $state("");
  let previewChecked = $derived(previewIsOn(previewStatus));

  async function refreshPreview() {
    try {
      previewStatus = await fetchPreviewRegistration();
    } catch (err) {
      previewStatus = null;
      previewMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async function runPreview(action: "register" | "unregister") {
    if (previewBusy) return;
    previewBusy = true;
    previewMessage = "";
    try {
      const next = await applyPreviewRegistration(action);
      previewStatus = next;
      previewMessage = next.cancelled
        ? "Administrator approval was cancelled. Registration was left unchanged."
        : next.message;
    } catch (err) {
      previewMessage = err instanceof Error ? err.message : String(err);
      await refreshPreview();
    } finally {
      previewBusy = false;
    }
  }

  function onPreviewToggle(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    input.checked = previewChecked;
    void runPreview(previewChecked ? "unregister" : "register");
  }

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
      class="border w-full max-w-lg max-h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden"
      style="background: var(--sdf-bg-chrome); border-color: var(--sdf-border); color: var(--sdf-text-secondary);"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div
        class="p-4 border-b flex items-center justify-between shrink-0"
        style="border-color: var(--sdf-border-subtle); background: color-mix(in srgb, var(--sdf-bg-surface) 60%, transparent);"
      >
        <div class="flex items-center gap-2">
          {#if view === "saved"}
            <button
              type="button"
              class="text-xs font-bold uppercase tracking-wider mr-1 transition-colors"
              style="color: var(--sdf-text-muted);"
              onclick={() => (view = "main")}
            >
              ← Back
            </button>
          {/if}
          <span class="text-xs font-bold uppercase tracking-widest" style="color: var(--sdf-text-secondary);">
            {view === "saved" ? "Saved Values" : "Settings"}
          </span>
        </div>
        <button
          type="button"
          onclick={closeWithoutSave}
          class="text-sm transition-colors" style="color: var(--sdf-text-muted);"
          title="Close without saving"
          aria-label="Close without saving"
        >✕</button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 space-y-6 text-xs leading-relaxed">
        {#if view === "main"}
          <!-- Theme -->
          <section>
            <h4 class="text-[11px] font-bold uppercase tracking-widest mb-2.5" style="color: var(--sdf-text-primary);">
              Theme
            </h4>
            <div class="flex gap-2">
              <button
                type="button"
                class="settings-theme-btn flex-1 py-2 rounded-lg border text-[11px] font-semibold transition-colors"
                class:settings-theme-active={draft.theme === 'dark'}
                onclick={() => (draft = { ...draft, theme: "dark" })}
              >
                Dark
              </button>
              <button
                type="button"
                class="settings-theme-btn flex-1 py-2 rounded-lg border text-[11px] font-semibold transition-colors"
                class:settings-theme-active={draft.theme === 'light'}
                onclick={() => (draft = { ...draft, theme: "light" })}
              >
                Light
              </button>
            </div>
          </section>

          <!-- Tools -->
          <section>
            <h4 class="text-[11px] font-bold uppercase tracking-widest mb-2.5" style="color: var(--sdf-text-primary);">
              Tools
            </h4>
            <p class="text-[10px] text-slate-500 mb-2">
              <span style="color: var(--sdf-text-muted);">Turn tools off to hide them from the right-click menu.</span>
            </p>
            <div class="space-y-1.5">
              {#each TOOL_IDS as id}
                <label
                  class="settings-row flex items-center justify-between gap-3 px-3 py-2 rounded-lg border cursor-pointer"
                >
                  <span class="text-[12px] font-medium" style="color: var(--sdf-text-primary);">
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
            <h4 class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color: var(--sdf-text-primary);">
              Network features
            </h4>
            <p class="text-[10px] text-slate-500 mb-2">
              These features need an internet connection. When off, using them shows a toast to enable here.
            </p>
            <div class="space-y-1.5">
              <label
                class="settings-row flex items-center justify-between gap-3 px-3 py-2 rounded-lg border cursor-pointer"
              >
                <div>
                  <div class="text-[12px] font-medium" style="color: var(--sdf-text-primary);">OCR</div>
                  <div class="text-[10px]" style="color: var(--sdf-text-muted);">Downloads models on first use</div>
                </div>
                <input
                  type="checkbox"
                  class="settings-toggle"
                  checked={draft.ocr}
                  onchange={() => (draft = { ...draft, ocr: !draft.ocr })}
                />
              </label>
              <div
                class="settings-coming-soon settings-row flex items-center justify-between gap-3 px-3 py-2 rounded-lg border opacity-55"
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
                class="settings-row flex items-center justify-between gap-3 px-3 py-2 rounded-lg border cursor-pointer"
              >
                <div>
                  <div class="text-[12px] font-medium" style="color: var(--sdf-text-primary);">
                    Check for updates on launch
                  </div>
                  <div class="text-[10px]" style="color: var(--sdf-text-muted);">Silent background update check</div>
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

          <!-- Markdown preview registration. Windows only. Immediate; not part of the Save draft. -->
          {#if previewOnWindows}
            {#snippet uacShield(id: string)}
              <svg class="settings-shield" viewBox="0 0 24 24" aria-hidden="true">
                <defs>
                  <clipPath id={id} clipPathUnits="userSpaceOnUse">
                    <path d="M12 1.15 21.25 4.55v7.6c0 5.3-3.95 9.75-9.25 11.2-5.3-1.45-9.25-5.9-9.25-11.2V4.55Z"/>
                  </clipPath>
                </defs>
                <g clip-path="url(#{id})">
                  <rect width="24" height="24" fill="#0078D4"/>
                  <rect width="24" height="8.6" fill="#4EA6EA"/>
                  <rect y="13.2" width="24" height="10.8" fill="#005A9E"/>
                  <path fill="#FFB900" d="M-2 14.15 26 7.05l.15 3.45L-1.85 17.6z"/>
                  <path fill="#FFE08A" d="M-2 13.2 26 6.1l.12 1.65L-1.88 14.85z"/>
                </g>
                <path
                  d="M12 1.15 21.25 4.55v7.6c0 5.3-3.95 9.75-9.25 11.2-5.3-1.45-9.25-5.9-9.25-11.2V4.55Z"
                  fill="none"
                  stroke="#004578"
                  stroke-width="0.8"
                />
              </svg>
            {/snippet}
            <section>
              <h4 class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color: var(--sdf-text-primary);">
                Preview
              </h4>
              <p class="text-[10px] mb-2" style="color: var(--sdf-text-muted);">
                Opt in to Markdown preview in Explorer and Outlook. Windows asks for administrator approval for that step only. speedDF itself stays a per-user install.
              </p>
              <label
                class="settings-row flex items-center justify-between gap-3 px-3 py-2 rounded-lg border cursor-pointer"
              >
                <span class="text-[12px] font-medium" style="color: var(--sdf-text-primary);">
                  Markdown preview in Explorer and Outlook
                </span>
                <input
                  type="checkbox"
                  class="settings-toggle"
                  checked={previewChecked}
                  disabled={previewBusy || previewStatus === null}
                  onchange={onPreviewToggle}
                />
              </label>
              <p class="text-[10px] mt-2 break-all" style="color: var(--sdf-text-muted);">
                {previewStatus
                  ? previewStatusLine(previewStatus)
                  : previewMessage || "Checking Explorer and Outlook registration…"}
              </p>
              <div class="flex flex-wrap gap-2 mt-2">
                <button
                  type="button"
                  class="settings-shield-btn"
                  disabled={previewBusy || previewStatus === null || (previewChecked && previewStatus.outlook_clicktorun === "yes")}
                  title="Windows will ask for administrator approval"
                  onclick={() => runPreview("register")}
                >
                  {@render uacShield("speeddf-uac-enable")}
                  Enable
                </button>
                <button
                  type="button"
                  class="settings-shield-btn"
                  disabled={previewBusy}
                  title="Write the Outlook registration again. Windows will ask for administrator approval"
                  onclick={() => runPreview("register")}
                >
                  {@render uacShield("speeddf-uac-repair")}
                  Repair
                </button>
                <button
                  type="button"
                  class="settings-shield-btn"
                  disabled={previewBusy || previewStatus === null || (!previewChecked && previewStatus.outlook_clicktorun !== "yes")}
                  title="Remove only the speedDF preview registration. Windows will ask for administrator approval"
                  onclick={() => runPreview("unregister")}
                >
                  {@render uacShield("speeddf-uac-disable")}
                  Disable
                </button>
              </div>
              {#if previewStatus && previewMessage}
                <p class="text-[10px] mt-2" style="color: var(--sdf-text-secondary);">{previewMessage}</p>
              {/if}
            </section>
          {/if}

          <!-- Saved values -->
          <section>
            <h4 class="text-[11px] font-bold uppercase tracking-widest mb-2.5" style="color: var(--sdf-text-primary);">
              Saved Values
            </h4>
            <button
              type="button"
              class="settings-row w-full py-2 px-3 rounded-lg border text-[11px] font-semibold transition-colors"
              style="color: var(--sdf-text-primary);"
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
        class="p-3 border-t flex items-center justify-end gap-2 shrink-0"
        style="border-color: var(--sdf-border-subtle); background: color-mix(in srgb, var(--sdf-bg-surface) 40%, transparent);"
      >
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors"
          style="color: var(--sdf-text-secondary); border-color: var(--sdf-border);"
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
    background: var(--sdf-hover-bg);
    border: 1px solid var(--sdf-active-bg);
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
    background: var(--sdf-text-secondary);
    transition: transform 0.15s ease, background 0.15s ease;
  }
  .settings-toggle:checked {
    background: rgba(8, 145, 178, 0.35);
    border-color: var(--sdf-accent);
  }
  .settings-toggle:checked::after {
    transform: translateX(1rem);
    background: var(--sdf-accent-text);
  }
  /* Static off state for coming-soon toggles (not an input) */
  .settings-toggle--off {
    cursor: default;
    pointer-events: none;
  }
  /* Greyed-out "coming soon" — no forbidden cursor */
  .settings-coming-soon {
    cursor: default;
  }
  .settings-coming-soon:disabled,
  .settings-coming-soon[aria-disabled="true"] {
    cursor: default;
  }
  /* Settings row items — theme-aware */
  .settings-row {
    border-color: var(--sdf-border-subtle);
    background: color-mix(in srgb, var(--sdf-bg-input) 40%, transparent);
  }
  .settings-row:hover {
    border-color: var(--sdf-border);
  }
  /* Theme toggle buttons */
  .settings-theme-btn {
    border-color: var(--sdf-border);
    background: color-mix(in srgb, var(--sdf-bg-input) 40%, transparent);
    color: var(--sdf-text-secondary);
  }
  .settings-theme-active {
    border-color: rgba(6, 182, 212, 0.6);
    background: rgba(8, 145, 178, 0.15);
    color: var(--sdf-accent-text);
  }
  .settings-shield-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--sdf-border);
    background: color-mix(in srgb, var(--sdf-bg-input) 40%, transparent);
    color: var(--sdf-text-primary);
    border-radius: 0.5rem;
    padding: 0.4rem 0.7rem;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .settings-shield-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .settings-shield {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    display: block;
  }
</style>
