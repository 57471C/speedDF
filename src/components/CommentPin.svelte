<script lang="ts">
  /**
   * On-page yellow comment pin:
   * - Draft mode: compose text before creating the thread
   * - Hover: show comment text only
   * - Click: open thread popout (edit / delete / replies + reply box)
   */
  import {
    activeDoc,
    addCommentAction,
    clearCommentPinDraft,
    deleteCommentAction,
    deleteReplyAction,
    replyToCommentAction,
    setOpenCommentPinId,
    updateCommentAction,
    updateReplyAction,
  } from "../pdfStore.svelte";
  import {
    formatCommentTime,
    type PageComment,
  } from "../lib/comments/comments";
  import { autoGrowTextarea } from "../lib/interaction/autoGrowTextarea";

  let {
    pageNumber,
    /** Existing thread (placed pin). Omit for draft compose pin. */
    thread = null,
    /** Draft placement (page %). Required when thread is null. */
    draftX = 50,
    draftY = 50,
    leftPct,
    topPct,
  }: {
    pageNumber: number;
    thread?: PageComment | null;
    draftX?: number;
    draftY?: number;
    leftPct: number;
    topPct: number;
  } = $props();

  let isDraft = $derived(!thread);
  let isOpen = $derived(
    isDraft
      ? true
      : activeDoc.openCommentPinId === thread?.id,
  );

  let hoverPreview = $state(false);
  let composeDraft = $state("");
  let replyDraft = $state("");
  let editing = $state(false);
  let editDraft = $state("");
  /** Reply currently being edited (id), if any. */
  let editingReplyId = $state<string | null>(null);
  let editReplyDraft = $state("");

  function autofocus(node: HTMLTextAreaElement) {
    requestAnimationFrame(() => {
      node.focus();
      const len = node.value.length;
      try {
        node.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
    });
  }

  function onPinClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (isDraft) return;
    if (!thread) return;
    if (activeDoc.openCommentPinId === thread.id) {
      setOpenCommentPinId(null);
    } else {
      setOpenCommentPinId(thread.id);
      editing = false;
      editingReplyId = null;
      editReplyDraft = "";
      replyDraft = "";
      hoverPreview = false;
    }
  }

  function onPinEnter() {
    if (!isOpen && thread) hoverPreview = true;
  }

  function onPinLeave() {
    hoverPreview = false;
  }

  function submitCompose() {
    if (!isDraft) return;
    const id = addCommentAction(pageNumber, composeDraft, {
      x: draftX,
      y: draftY,
    });
    if (!id) return;
    composeDraft = "";
    clearCommentPinDraft();
    // Close after post — pin remains on the page; reopen via click
    setOpenCommentPinId(null);
  }

  function cancelCompose() {
    composeDraft = "";
    clearCommentPinDraft();
  }

  function startEdit() {
    if (!thread) return;
    editDraft = thread.text || "";
    editing = true;
  }

  function saveEdit() {
    if (!thread) return;
    if (updateCommentAction(thread.id, editDraft)) {
      editing = false;
    }
  }

  function cancelEdit() {
    editing = false;
    editDraft = "";
  }

  function startEditReply(replyId: string, text: string) {
    editingReplyId = replyId;
    editReplyDraft = text || "";
    editing = false;
  }

  function saveEditReply() {
    if (!thread || !editingReplyId) return;
    if (updateReplyAction(thread.id, editingReplyId, editReplyDraft)) {
      editingReplyId = null;
      editReplyDraft = "";
    }
  }

  function cancelEditReply() {
    editingReplyId = null;
    editReplyDraft = "";
  }

  function submitReply() {
    if (!thread) return;
    const id = replyToCommentAction(thread.id, replyDraft);
    if (id) replyDraft = "";
  }

  function removeThread() {
    if (!thread) return;
    deleteCommentAction(thread.id);
    setOpenCommentPinId(null);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="comment-pin absolute z-[45] pointer-events-auto"
  style="left: {leftPct}%; top: {topPct}%;"
  onpointerdown={(e) => e.stopPropagation()}
  onmousedown={(e) => e.stopPropagation()}
>
  <button
    type="button"
    class="comment-pin__btn absolute -translate-x-1/2 -translate-y-full
      flex items-center justify-center w-5 h-6 p-0 border-0 bg-transparent cursor-pointer
      drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)] hover:scale-110 active:scale-95 transition-transform
      {isDraft || isOpen ? 'scale-110' : ''}"
    style="left: 0; top: 0;"
    onclick={onPinClick}
    onmouseenter={onPinEnter}
    onmouseleave={onPinLeave}
  >
    <svg
      width="18"
      height="22"
      viewBox="0 0 18 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M9 21s-6.5-5.2-6.5-11a6.5 6.5 0 1 1 13 0c0 5.8-6.5 11-6.5 11z"
        fill="#facc15"
        stroke="#ca8a04"
        stroke-width="1.1"
      />
      <circle cx="9" cy="9.5" r="2.2" fill="#854d0e" opacity="0.85" />
    </svg>
  </button>

  <!-- Hover: initials + comment; replies under faint rules -->
  {#if hoverPreview && !isOpen && thread}
    <div
      class="absolute left-2 top-0 z-50 max-w-[220px] min-w-[120px]
        bg-slate-950/95 border border-slate-800 rounded-lg px-2 py-1.5 shadow-2xl backdrop-blur-sm
        pointer-events-none"
      role="tooltip"
    >
      <p
        class="text-[10px] text-slate-200 leading-snug whitespace-pre-wrap break-words font-sans"
      >
        <strong class="text-slate-100 font-semibold"
          >{thread.author || "You"}:</strong
        >
        {" "}{thread.text || "Untitled note"}
      </p>
      {#each thread.replies || [] as reply (reply.id)}
        <hr class="my-1.5 border-0 border-t border-slate-700/50" />
        <p
          class="text-[10px] text-slate-300 leading-snug whitespace-pre-wrap break-words font-sans"
        >
          <strong class="text-slate-200 font-semibold"
            >{reply.author || "You"}:</strong
          >
          {" "}{reply.text}
        </p>
      {/each}
    </div>
  {/if}

  <!-- Open popout: draft compose OR full thread -->
  {#if isOpen}
    <div
      class="absolute left-2 top-0 z-50 flex flex-col gap-1.5
        bg-slate-950/95 border border-slate-800 rounded-lg px-2 py-1.5 shadow-2xl backdrop-blur-sm
        min-w-[200px] max-w-[260px]"
      onmouseenter={() => (hoverPreview = false)}
    >
      {#if isDraft}
        <span
          class="text-[8px] font-bold uppercase tracking-widest text-slate-500"
        >
          New comment
        </span>
        <div class="flex items-start gap-1.5">
          <textarea
            use:autofocus
            use:autoGrowTextarea={{ minRows: 2, maxRows: 12 }}
            bind:value={composeDraft}
            rows="2"
            placeholder="Add a note…"
            onkeydown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submitCompose();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelCompose();
              }
            }}
            class="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50 flex-1 min-w-0 font-sans resize-none leading-relaxed overflow-hidden"
          ></textarea>
          <button
            type="button"
            onclick={submitCompose}
            disabled={!composeDraft.trim()}
            class="p-0.5 rounded shrink-0 transition-colors mt-0.5
              {composeDraft.trim()
                ? 'text-emerald-400 hover:bg-slate-800'
                : 'text-slate-600 cursor-not-allowed'}"
            title="Post comment (Ctrl+Enter)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><polyline points="20 6 9 17 4 12" /></svg
            >
          </button>
        </div>
        <button
          type="button"
          onclick={cancelCompose}
          class="self-end text-[9px] font-bold uppercase text-slate-500 hover:text-slate-300"
        >
          Cancel
        </button>
      {:else if thread}
        <!-- Header: author + actions -->
        <div class="flex items-start justify-between gap-1">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span
                class="text-[10px] font-semibold text-slate-200 truncate"
                title={thread.authorFullName || thread.author}
                >{thread.author}</span
              >
              <span class="text-[8px] text-slate-600 font-mono"
                >{formatCommentTime(thread.createdAt)}</span
              >
            </div>
          </div>
          <div class="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onclick={startEdit}
              class="p-0.5 rounded text-slate-500 hover:text-amber-400 hover:bg-slate-800"
              title="Edit comment"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path d="M12 20h9" /><path
                  d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
                /></svg
              >
            </button>
            <button
              type="button"
              onclick={removeThread}
              class="p-0.5 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800"
              title="Delete thread"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><polyline points="3 6 5 6 21 6" /><path
                  d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                /></svg
              >
            </button>
            <button
              type="button"
              onclick={() => setOpenCommentPinId(null)}
              class="p-0.5 rounded text-slate-600 hover:text-slate-300 hover:bg-slate-800"
              title="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><line x1="18" y1="6" x2="6" y2="18" /><line
                  x1="6"
                  y1="6"
                  x2="18"
                  y2="18"
                /></svg
              >
            </button>
          </div>
        </div>

        {#if editing}
          <div class="flex flex-col gap-1">
            <textarea
              use:autofocus
              use:autoGrowTextarea={{ minRows: 2, maxRows: 12 }}
              bind:value={editDraft}
              rows="2"
              onkeydown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              class="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none focus:border-amber-500/50 font-sans resize-none leading-relaxed overflow-hidden"
            ></textarea>
            <div class="flex justify-end gap-1.5">
              <button
                type="button"
                onclick={cancelEdit}
                class="px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500 hover:text-slate-300"
                >Cancel</button
              >
              <button
                type="button"
                onclick={saveEdit}
                disabled={!editDraft.trim()}
                class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase
                  {editDraft.trim()
                    ? 'bg-amber-600/25 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed'}"
                >Save</button
              >
            </div>
          </div>
        {:else}
          <p
            class="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap break-words font-sans"
          >
            {thread.text}
          </p>
        {/if}

        {#if (thread.replies || []).length > 0}
          <div
            class="border-t border-slate-900/60 pt-1.5 space-y-1.5 max-h-[120px] overflow-y-auto"
          >
            {#each thread.replies || [] as reply (reply.id)}
              <div class="pl-1.5 border-l-2 border-slate-800">
                <div class="flex items-start justify-between gap-1">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span
                      class="text-[9px] font-semibold text-slate-400 truncate"
                      title={reply.authorFullName || reply.author}
                      >{reply.author}</span
                    >
                    <span class="text-[8px] text-slate-600 font-mono"
                      >{formatCommentTime(reply.createdAt)}</span
                    >
                  </div>
                  <div class="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onclick={() => startEditReply(reply.id, reply.text)}
                      class="p-0.5 rounded text-slate-600 hover:text-amber-400 hover:bg-slate-800"
                      title="Edit reply"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="9"
                        height="9"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        ><path d="M12 20h9" /><path
                          d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
                        /></svg
                      >
                    </button>
                    <button
                      type="button"
                      onclick={() => deleteReplyAction(thread.id, reply.id)}
                      class="p-0.5 rounded text-slate-700 hover:text-red-400 shrink-0"
                      title="Delete reply"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="9"
                        height="9"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        ><polyline points="3 6 5 6 21 6" /><path
                          d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                        /></svg
                      >
                    </button>
                  </div>
                </div>
                {#if editingReplyId === reply.id}
                  <div class="flex flex-col gap-1 mt-0.5">
                    <textarea
                      use:autofocus
                      use:autoGrowTextarea={{ minRows: 2, maxRows: 8 }}
                      bind:value={editReplyDraft}
                      rows="2"
                      onkeydown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          saveEditReply();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEditReply();
                        }
                      }}
                      class="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none focus:border-amber-500/50 font-sans resize-none leading-relaxed overflow-hidden"
                    ></textarea>
                    <div class="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onclick={cancelEditReply}
                        class="px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500 hover:text-slate-300"
                        >Cancel</button
                      >
                      <button
                        type="button"
                        onclick={saveEditReply}
                        disabled={!editReplyDraft.trim()}
                        class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase
                          {editReplyDraft.trim()
                            ? 'bg-amber-600/25 text-amber-300 border border-amber-500/40'
                            : 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed'}"
                        >Save</button
                      >
                    </div>
                  </div>
                {:else}
                  <p
                    class="text-[10px] text-slate-400 leading-relaxed whitespace-pre-wrap break-words mt-0.5 font-sans"
                  >
                    {reply.text}
                  </p>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <!-- Reply box -->
        <div class="border-t border-slate-900/60 pt-1.5 flex flex-col gap-1">
          <textarea
            use:autoGrowTextarea={{ minRows: 2, maxRows: 12 }}
            bind:value={replyDraft}
            rows="2"
            placeholder="Write a reply…"
            onkeydown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submitReply();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setOpenCommentPinId(null);
              }
            }}
            class="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[10px] text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-cyan-500/50 font-sans overflow-hidden"
          ></textarea>
          <div class="flex justify-end gap-1.5">
            <button
              type="button"
              onclick={() => setOpenCommentPinId(null)}
              class="px-2 py-0.5 text-[9px] font-bold uppercase text-slate-500 hover:text-slate-300"
            >
              Close
            </button>
            <button
              type="button"
              onclick={submitReply}
              disabled={!replyDraft.trim()}
              class="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide
                {replyDraft.trim()
                  ? 'bg-cyan-600/25 text-cyan-300 border border-cyan-500/40'
                  : 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed'}"
            >
              Post reply
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
