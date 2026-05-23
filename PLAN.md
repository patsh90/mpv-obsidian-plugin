# Warning Fix Plan

Grouped by file. Fixes are ordered from safest/smallest to most impactful.

---

## 1. `esbuild.config.mjs` + `package.json`

**Warning:** `"builtin-modules"` should be replaced with an alternative package.

**Fix:** Replace the `builtin-modules` npm package with the native Node.js built-in:

```js
// Before
import builtins from "builtin-modules";

// After
import { builtinModules } from "node:module";
```

Then remove `"builtin-modules": "3.3.0"` from `devDependencies` in `package.json`.  
The array spread `...builtins` → `...builtinModules` works identically.

---

## 2. `src/hash.ts`

### 2a. Undescribed eslint-disable directive (line 50)

```ts
// Before
// eslint-disable-next-line @typescript-eslint/no-explicit-any

// After
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- bun-types incorrectly types fs.promises.open as Promise<number>; at runtime it returns a FileHandle
```

(The existing code comment on line 49 already explains why — the eslint directive just needs the explanation moved into it.)

### 2b. Unused caught error variables (lines 88, 109)

Two `catch (error)` blocks where `error` is never referenced. Rename to `_error` to satisfy the `/^\_/u` allowlist pattern.

```ts
// Before
} catch (error) {
    console.warn(`Could not read directory: ${dir}`);
}

// After
} catch (_error) {
    console.warn(`Could not read directory: ${dir}`);
}
```

Same change at line 109 in `buildHashMap`.

### 2c. Use `activeWindow.setTimeout` (line 168)

```ts
// Before
const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));

// After
const yieldToUI = () => new Promise<void>(resolve => activeWindow.setTimeout(resolve, 0));
```

`activeWindow` is a global provided by Obsidian's runtime — no import needed.

---

## 3. `src/main.ts`

### 3a. Promise rejection should be an Error (line 93)

`execFile`'s callback types `error` as `ExecFileException | null`. Even though `ExecFileException extends Error`, the linter flags this because it sees the pre-narrowed type which includes `null`. Fix by making the intent explicit:

```ts
// Before
if (error) {
    reject(error);
}

// After
if (error) {
    reject(error instanceof Error ? error : new Error(String(error)));
}
```

### 3b. `document.createElement` / `document` global (line 102)

Replace with Obsidian's `createEl` global, which uses `activeDocument` internally and is the recommended API:

```ts
// Before
const button = document.createElement("button");

// After
const button = createEl("button");
```

This fixes both the `document.createElement` warning and the `activeDocument` warning in one change.

### 3c. `onload()` returns Promise where void expected (lines 124–151)

The `Plugin` base class declares `onload(): void`. Overriding it with `async onload(): Promise<void>` triggers `@typescript-eslint/no-misused-promises`. Extract the async body into a private `initialize()` method:

```ts
// Before
async onload(): Promise<void> {
    await this.loadSettings();
    // ...
}

// After
onload(): void {
    void this.initialize();
}

private async initialize(): Promise<void> {
    await this.loadSettings();
    // ...
}
```

### 3d. Unnecessary type assertions (lines 140, 313)

Use the generic overload of `querySelectorAll` to get the correct type without an assertion:

```ts
// Before
const buttons = Array.from(el.querySelectorAll("button")) as HTMLButtonElement[];

// After
const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>("button"));
```

Same fix at line 313 inside `updateButtonsList`.

### 3e. Async callbacks where void return expected (lines 162–177, 413–475)

The `PathSelectModal` `onSelect` callback is typed as `(paths: string[]) => void`, but async functions are passed as callers. Two complementary fixes:

1. Update `PathSelectModal`'s `onSelect` type to `(paths: string[]) => void | Promise<void>` (see §5a below).
2. Wrap the call site in `main.ts` where needed so the type lines up (covered by §5a).

### 3f. Command name includes plugin name (line 203)

Obsidian's linter flags command names that embed the plugin name because the plugin name is already shown next to the command in the UI. Only the "Clean dead mpv links" command is flagged (the others use "MPV" as part of the noun, not just the plugin name):

```ts
// Before
name: "Clean dead mpv links",

// After
name: "Clean dead links",
```

### 3g. Unused variable `vaultBasePath` (line 219)

`createButtonsFromMarkdown` declares `vaultBasePath` but never uses it. Remove the line:

```ts
// Delete:
const vaultBasePath = getVaultBasePath(this.app);
```

### 3h. Unhandled promise from `this.openVideoAtTime` (line 225)

Inside the `forEach` callback, `openVideoAtTime` is async and its promise is silently discarded. Mark it intentionally with `void`:

```ts
// Before
this.openVideoAtTime(details.filepath, button);

// After
void this.openVideoAtTime(details.filepath, button);
```

---

## 4. `src/modals/PathSelectModal.ts`

### 4a. `onOpen()` returns Promise where void expected (lines 27–57)

`Modal.onOpen()` is declared as `(): void`. Extract the async dialog logic into a private method:

```ts
// Before
async onOpen(): Promise<void> {
    // ...dialog logic...
}

// After
onOpen(): void {
    void this.showDialog();
}

private async showDialog(): Promise<void> {
    // ...same dialog logic...
}
```

Also update the `onSelect` callback type:

```ts
// Before
private onSelect: (paths: string[]) => void;

// After
private onSelect: (paths: string[]) => void | Promise<void>;
```

And the constructor parameter type accordingly.

---

## 5. `src/modals/ProgressModal.ts`

### 5a. Avoid `element.style.width` (line 38)

The linter recommends `setCssProps` for dynamic style values. Use a CSS custom property:

```ts
// Initialization (line 38)
// Before
this.fillEl.style.width = "0%";

// After — set initial CSS var
this.fillEl.setCssProps({ '--progress-fill-width': '0%' });

// updateProgress method — same pattern
// Before
this.fillEl.style.width = `${percent}%`;

// After
this.fillEl.setCssProps({ '--progress-fill-width': `${percent}%` });
```

Add the corresponding rule to `styles.css`:

```css
.progress-modal-fill {
    width: var(--progress-fill-width, 0%);
}
```

---

## 6. `src/typings/obsidian-ex.d.ts`

### 6a. Undescribed eslint-disable directive (line 40)

```ts
// Before
/* eslint-disable @typescript-eslint/no-explicit-any */

// After
/* eslint-disable @typescript-eslint/no-explicit-any -- third-party Obsidian internal typings use any extensively */
```

### 6b. Literal types overridden by broader type in union (many lines)

All of these follow the same pattern: a specific literal is redundant when a broader type covers it. Fix by removing the redundant literal and keeping only the broader type.

| Pattern | Example before | After |
|---|---|---|
| `"0.0.0" \| string` | line 207 | `string` |
| `"" \| string` | lines 260, 1229, 1274, 1311, 1327, 1335, 1428 | `string` |
| `false \| boolean` | lines 1233, 1315, 1357, 1376, 1380, 1392, 1396, 1400, 1408, 1420, 1438, 1450, 1462 | `boolean` |
| `true \| boolean` | lines 1241, 1245, 1249, 1257, 1282, 1294, 1298, 1302, 1319, 1364, 1372, 1384, 1388, 1404, 1454 | `boolean` |
| `"/" \| string` | lines 1237, 1343 | `string` |
| `16 \| number` | line 1253 | `number` |
| `"command-palette:open" \| string` | line 1323 | `string` |
| `"letter" \| string` | line 1356 | `string` |
| `"0" \| string` | line 1358 | `string` |
| `100 \| number` | line 1359 | `number` |
| `4 \| number` | line 1424 | `number` |

**Note:** This file is a community-maintained typings shim for Obsidian internals. These union types exist intentionally to document the known default values — removing the literals loses that documentation value. Consider whether the linter suppression would be more appropriate than removing the intent.

### 6c. `'EScope' acts as 'any'` (line 2042)

`EScope` is an `error` (not `Error`) type that acts as `any` and overrides all other types. Need to inspect line 2042 to determine the correct fix — likely change `EScope` to a proper typed interface or `Error`.

---

## 7. `src/utils.ts`

### 7a. Unnecessary console logging (line 105)

The `log()` utility wraps `console.log` behind the `LOGINFO` flag. Suppress with a described directive:

```ts
// Before
console.log(msg);

// After
// eslint-disable-next-line no-console -- debug logging gated behind LOGINFO flag
console.log(msg);
```

---

## Risk Assessment

| Fix | Risk | Notes |
|---|---|---|
| `builtin-modules` → `node:module` | Low | Identical runtime behavior |
| eslint-disable descriptions | None | Comment-only changes |
| `catch (_error)` rename | None | No behavior change |
| `activeWindow.setTimeout` | Low | Obsidian global, always available |
| `reject` → wrap with instanceof | Low | ExecFileException already extends Error; wrapping is safe |
| `createEl("button")` | Low | Direct Obsidian equivalent |
| `onload()` → `initialize()` extract | Medium | Must ensure `void` propagation doesn't swallow errors |
| Remove querySelectorAll assertions | Low | Generic overload gives same type |
| `PathSelectModal.onSelect` type | Low | Widening the type; all callers still valid |
| Command name rename | Low | UI-only change |
| Remove unused `vaultBasePath` | Low | Already confirmed unused |
| `void openVideoAtTime(...)` | None | Makes existing intent explicit |
| `PathSelectModal.onOpen` extract | Medium | Same as onload pattern |
| `setCssProps` for progress bar | Low | Requires `styles.css` update |
| `obsidian-ex.d.ts` literal unions | Medium | Loses default-value documentation; consider eslint-disable instead |
| `EScope` type fix | Medium | Need to read line 2042 context first |
| `console.log` eslint-disable | None | Comment-only change |
