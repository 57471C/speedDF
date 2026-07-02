# Todo List

## Features
1. select text/copy text
2. snapshot tool
3. File tabs
4. "Speed loading" maybe a progessbar and a background "Loaded in: ##ms" burned into the background.
5. Buy me a coffee in help modal and welcome message

```html
<a href="https://buymeacoffee.com/speeddf" target="_blank" class="bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 hover:bg-yellow-500/20 hover:border-yellow-500/60 transition-all duration-150 px-4 py-2 text-xs font-mono uppercase tracking-wider rounded-full flex items-center gap-2">

                <span class="material-symbols-outlined text-sm">coffee</span>

                <span class="hidden sm:inline">Buy me a coffee</span>

            </a>
```

## Fixes
1. Scaling is a bit off for annotations (stamps and singnatures - possibly others) are slightly lager after saving.
2. Printing in other OS's
```plaintext
Eagle eye! You are mostly right, but check out the subtle difference between where it's handled and where it isn't:

Workspace.svelte (Line 349): if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') — This one is Mac-enabled!

+page.svelte (Line 468): if (e.ctrlKey && e.key.toLowerCase() === 'p') — This is our newly built window capturing firewall, and it is currently Windows-only.

Because +page.svelte doesn't trap e.metaKey, pressing Cmd + P on a Mac will slip right through our new firewall and fall back down to Workspace.svelte. Depending on what Workspace.svelte triggers inside, it could cause split behaviors later.

But since Windows is our primary target, this is a perfectly safe micro-optimization to park until you're ready to do your final cross-platform polish sweep!
```
