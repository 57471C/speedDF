<script lang="ts">
  import {
    activeDoc,
    setFormFieldValueAction,
    type SignatureSet,
  } from "../pdfStore.svelte";
  import {
    fieldsForPage,
    isSignatureStampValue,
    type FormFieldDef,
    type FormFieldValue,
  } from "../lib/forms/formFields";
  import {
    initialsFromName,
    setCommentAuthorProfile,
    signatureSetLabel,
  } from "../lib/comments/comments";

  let { pageNumber } = $props<{ pageNumber: number }>();

  let pageFields = $derived(fieldsForPage(activeDoc.formFields, pageNumber));

  /**
   * Form fill when the select tool is active so drawing tools are not stolen.
   * Text tool also allows focus into fields for quick typing.
   */
  let interactive = $derived(
    activeDoc.activeTool === "select" || activeDoc.activeTool === "text",
  );

  /** Field currently choosing a stamp (signature widgets only). */
  let pickingField = $state<FormFieldDef | null>(null);
  /** Document id when picker opened — multi-tab safe apply. */
  let pickingDocId = $state<string | null>(null);

  function fieldValue(field: FormFieldDef): FormFieldValue {
    const v = activeDoc.formValues?.[field.name];
    if (v !== undefined) return v;
    if (field.type === "checkbox") return false;
    return "";
  }

  function onTextInput(field: FormFieldDef, e: Event) {
    if (field.readOnly) return;
    const el = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    setFormFieldValueAction(field.name, el.value);
  }

  function onCheckboxChange(field: FormFieldDef, e: Event) {
    if (field.readOnly) return;
    const el = e.currentTarget as HTMLInputElement;
    setFormFieldValueAction(field.name, el.checked);
  }

  function onDropdownChange(field: FormFieldDef, e: Event) {
    if (field.readOnly) return;
    const el = e.currentTarget as HTMLSelectElement;
    setFormFieldValueAction(field.name, el.value);
  }

  function stopBubble(e: Event) {
    e.stopPropagation();
  }

  function openSignaturePicker(field: FormFieldDef, e: Event) {
    stopBubble(e);
    if (field.readOnly || !interactive) return;
    pickingField = field;
    pickingDocId = activeDoc.activeDocumentId;
  }

  function closeSignaturePicker() {
    pickingField = null;
    pickingDocId = null;
  }

  function applyStampToField(
    dataUrl: string,
    set?: SignatureSet,
  ) {
    if (!pickingField) return;
    // Ignore if user switched tabs while the picker was open
    if (pickingDocId && activeDoc.activeDocumentId !== pickingDocId) {
      closeSignaturePicker();
      return;
    }
    setFormFieldValueAction(pickingField.name, dataUrl);
    // Keep comment author in sync when a profile set is used (same as free stamps)
    if (set && (set.initials || set.firstName || set.lastName)) {
      const fullName =
        `${set.firstName || ""} ${set.lastName || ""}`.trim() ||
        set.label?.replace(/:$/, "") ||
        set.initials ||
        "You";
      setCommentAuthorProfile({
        initials:
          set.initials ||
          initialsFromName(set.firstName || "", set.lastName || ""),
        fullName,
        email: set.email,
      });
    }
    closeSignaturePicker();
  }

  function clearSignatureField(field: FormFieldDef, e: Event) {
    stopBubble(e);
    if (field.readOnly) return;
    setFormFieldValueAction(field.name, "");
  }

  // Close picker if active document changes mid-flight
  $effect(() => {
    const id = activeDoc.activeDocumentId;
    if (pickingField && pickingDocId && id !== pickingDocId) {
      closeSignaturePicker();
    }
  });

  let savedSets = $derived(activeDoc.savedSignatureSets || []);

  /** Escape page transform/overflow so the picker covers the full window. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }

  function onPickerKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeSignaturePicker();
    }
  }
</script>

{#if pageFields.length > 0}
  <div
    class="absolute inset-0 z-[32] overflow-hidden rounded-sm pointer-events-none"
    aria-hidden={!interactive}
  >
    {#each pageFields as field (field.name + ":" + field.widgetIndex)}
      <div
        class="absolute form-field-chrome
          {interactive ? 'pointer-events-auto' : 'pointer-events-none'}
          {field.readOnly ? 'opacity-80' : ''}"
        style="left: {field.x}%; top: {field.y}%; width: {field.width}%; height: {field.height}%;"
        onmousedown={stopBubble}
        onpointerdown={stopBubble}
      >
        {#if field.type === "text"}
          <input
            type="text"
            value={String(fieldValue(field) ?? "")}
            oninput={(e) => onTextInput(field, e)}
            onmousedown={stopBubble}
            onpointerdown={stopBubble}
            readonly={field.readOnly}
            maxlength={field.maxLength || undefined}
            title={field.name}
            class="form-field-input w-full h-full"
            class:form-field-readonly={field.readOnly}
          />
        {:else if field.type === "checkbox"}
          <label
            class="form-field-checkbox-wrap w-full h-full flex items-center justify-center cursor-pointer"
            title={field.name}
          >
            <input
              type="checkbox"
              checked={fieldValue(field) === true}
              onchange={(e) => onCheckboxChange(field, e)}
              onmousedown={stopBubble}
              onpointerdown={stopBubble}
              disabled={field.readOnly}
              class="form-field-checkbox"
            />
          </label>
        {:else if field.type === "dropdown"}
          <select
            value={String(fieldValue(field) ?? "")}
            onchange={(e) => onDropdownChange(field, e)}
            onmousedown={stopBubble}
            onpointerdown={stopBubble}
            disabled={field.readOnly}
            title={field.name}
            class="form-field-input form-field-select w-full h-full"
          >
            <option value="">—</option>
            {#each field.options || [] as opt}
              <option value={opt}>{opt}</option>
            {/each}
          </select>
        {:else if field.type === "signature"}
          {@const stamp = fieldValue(field)}
          <div class="form-field-signature-wrap w-full h-full relative">
            {#if isSignatureStampValue(stamp)}
              <button
                type="button"
                class="form-field-signature form-field-signature-filled w-full h-full"
                title={field.readOnly ? field.name : `${field.name} — click to change`}
                onclick={(e) => openSignaturePicker(field, e)}
                onmousedown={stopBubble}
                onpointerdown={stopBubble}
                disabled={field.readOnly}
              >
                <img src={stamp} alt="Signature" class="form-field-signature-img" />
              </button>
              {#if !field.readOnly && interactive}
                <button
                  type="button"
                  class="form-field-signature-clear"
                  title="Clear signature"
                  onclick={(e) => clearSignatureField(field, e)}
                  onmousedown={stopBubble}
                  onpointerdown={stopBubble}
                  aria-label="Clear signature"
                >×</button>
              {/if}
            {:else}
              <button
                type="button"
                class="form-field-signature form-field-signature-empty w-full h-full"
                title={field.readOnly ? field.name : `${field.name} — click to sign`}
                onclick={(e) => openSignaturePicker(field, e)}
                onmousedown={stopBubble}
                onpointerdown={stopBubble}
                disabled={field.readOnly}
              >
                <span class="form-field-signature-hint">Sign</span>
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if pickingField}
  <!-- Signature / initials stamp selector (reuses saved stamp sets; no new drawing) -->
  <div
    use:portal
    class="fixed inset-0 z-[200] flex items-center justify-center pointer-events-auto"
    role="dialog"
    aria-modal="true"
    aria-label="Choose signature stamp"
    onkeydown={onPickerKeydown}
  >
    <button
      type="button"
      class="absolute inset-0 bg-black/50 cursor-default border-0 p-0"
      aria-label="Close signature picker"
      onclick={closeSignaturePicker}
    ></button>
    <div
      class="relative w-80 max-w-[90vw] bg-[#090d16] border border-slate-800 rounded-lg shadow-2xl p-3 flex flex-col gap-2 text-left"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="document"
    >
      <div class="flex items-center justify-between border-b border-slate-900/60 pb-1.5">
        <span class="text-[9px] font-bold tracking-widest uppercase text-slate-500">
          Choose Stamp
        </span>
        <button
          type="button"
          class="text-slate-500 hover:text-white text-sm leading-none px-1"
          onclick={closeSignaturePicker}
          title="Close"
        >×</button>
      </div>
      <p class="text-[10px] text-slate-500 truncate" title={pickingField.name}>
        Field: {pickingField.name}
      </p>
      <div class="max-h-56 overflow-y-auto space-y-2 pr-1">
        {#each savedSets as set (set.id)}
          <div
            class="flex flex-col gap-1 bg-[#141b2b]/60 border border-slate-900 rounded p-1.5"
          >
            {#if set.label || set.firstName || set.lastName}
              <div class="flex items-center justify-between gap-1 px-0.5">
                <span class="text-[9px] font-semibold text-slate-300 truncate">
                  {set.label ||
                    signatureSetLabel(set.firstName || "", set.lastName || "")}
                </span>
                {#if set.initials}
                  <span class="text-[8px] font-mono font-bold text-cyan-500/80 shrink-0"
                    >{set.initials}</span
                  >
                {/if}
              </div>
            {/if}
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                onclick={() => applyStampToField(set.signatureDataUrl, set)}
                class="flex-1 h-12 bg-white rounded flex items-center justify-center border border-transparent hover:border-[#00d2ff] p-1 overflow-hidden"
                title="Use signature"
              >
                <img
                  src={set.signatureDataUrl}
                  alt="Signature"
                  class="max-h-full max-w-full object-contain"
                />
              </button>
              <button
                type="button"
                onclick={() => applyStampToField(set.initialDataUrl, set)}
                class="w-14 h-12 bg-white rounded flex items-center justify-center border border-transparent hover:border-[#00d2ff] p-1 overflow-hidden"
                title="Use initials"
              >
                <img
                  src={set.initialDataUrl}
                  alt="Initials"
                  class="max-h-full max-w-full object-contain"
                />
              </button>
            </div>
          </div>
        {:else}
          <div class="text-[10px] text-slate-600 font-medium italic text-center py-6">
            No saved stamp sets. Create one from the Signatures tool in the sidebar.
          </div>
        {/each}
      </div>
      <button
        type="button"
        class="w-full mt-0.5 py-1.5 text-[10px] font-bold text-slate-400 hover:text-white border border-slate-800 rounded"
        onclick={closeSignaturePicker}
      >
        Cancel
      </button>
    </div>
  </div>
{/if}

<style>
  .form-field-chrome {
    box-sizing: border-box;
  }

  .form-field-input {
    box-sizing: border-box;
    margin: 0;
    padding: 1px 3px;
    border: 1px solid rgba(14, 165, 233, 0.45);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.72);
    color: #0f172a;
    font-size: 11px;
    font-family: Helvetica, Arial, sans-serif;
    line-height: 1.2;
    outline: none;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease,
      background 0.12s ease;
  }

  .form-field-input:hover:not(:disabled):not(:read-only) {
    border-color: rgba(14, 165, 233, 0.85);
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 0 0 1px rgba(14, 165, 233, 0.2);
  }

  .form-field-input:focus {
    border-color: #06b6d4;
    background: #fff;
    box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.35);
  }

  .form-field-readonly {
    background: rgba(241, 245, 249, 0.7);
    border-color: rgba(148, 163, 184, 0.5);
    color: #475569;
  }

  .form-field-select {
    cursor: pointer;
    appearance: auto;
    padding-right: 2px;
  }

  .form-field-checkbox-wrap {
    border: 1px solid rgba(14, 165, 233, 0.4);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.55);
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease,
      background 0.12s ease;
  }

  .form-field-checkbox-wrap:hover {
    border-color: rgba(14, 165, 233, 0.85);
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 1px rgba(14, 165, 233, 0.2);
  }

  .form-field-checkbox-wrap:focus-within {
    border-color: #06b6d4;
    box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.35);
  }

  .form-field-checkbox {
    width: 70%;
    height: 70%;
    max-width: 18px;
    max-height: 18px;
    margin: 0;
    cursor: pointer;
    accent-color: #0891b2;
  }

  .form-field-signature-wrap {
    box-sizing: border-box;
  }

  .form-field-signature {
    box-sizing: border-box;
    margin: 0;
    padding: 2px;
    border: 1px solid rgba(14, 165, 233, 0.45);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.72);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease,
      background 0.12s ease;
  }

  .form-field-signature:hover:not(:disabled) {
    border-color: rgba(14, 165, 233, 0.85);
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 0 0 1px rgba(14, 165, 233, 0.2);
  }

  .form-field-signature:disabled {
    cursor: default;
  }

  .form-field-signature-empty {
    border-style: dashed;
  }

  .form-field-signature-hint {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #0891b2;
    opacity: 0.85;
    pointer-events: none;
  }

  .form-field-signature-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    pointer-events: none;
  }

  .form-field-signature-clear {
    position: absolute;
    top: 1px;
    right: 1px;
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    border-radius: 2px;
    background: rgba(15, 23, 42, 0.55);
    color: #fff;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
  }

  .form-field-signature-clear:hover {
    background: rgba(239, 68, 68, 0.85);
  }
</style>
