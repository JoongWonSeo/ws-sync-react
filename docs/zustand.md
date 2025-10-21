## Background on React

So your app has some state, and you want react to render its latest values at all times.

In "traditional" rendering like games, you freely mutate state, and just always render it 60 times a second.
But unlike games, browser apps don't change all that often, so we want to render "reactively", i.e. only re-render **when the state actually changes**. Esp. because rendering DOM is expensive.

> _Note that with "rendering" we mean updating the DOM, the browser has a separate renderer that renders the DOM, e.g. while scrolling or zooming or for css animations_

## How Zustand works

Actually very similar to reducers, except that it's just a normal javascript object for holding state, and a hook that subscribes to updates for re-rendering.

### 1. Defining your state

This happens **outside of React**, in the "normal" JavaScript world.

**State**: user defined object holding the state
**Store**: holds the state, gates access via getters and setters
**Actions**: functions that manipulates the state via the store setters (not directly!). It's just a normal function, so you can make it async, return values, etc.

###### Q: Why can't we just directly manipulate the raw state without the store?

Because without the setter, we have no way to detect that the setter was called and that react should (potentially) re-render the parts that changed.

### 2. Changing the state

A Zustand store has a `setState(update)` function which actually _shallow merges_ the state (i.e. overwriting only the specified fields). If you actually want to _set_ the entire state, you provide a second argument `setState(newState, true)`.

In Zustand, the concept of actions is just a convention. Having the actions inside the state just helps enforce that the actions should be concerned with the state, so that they are not too tightly coupled with the UI component.
For example, instead of defining your functions within the React component that calls `store.setState` directly, which is totally possible, you _really_ should be defining a new action where the store is and calling that instead.

#### Common pitfalls

##### 1. **Setting unrelated parts of state / too generic actions**

Essentially, this means the action doesn't capture actual the _intent_ of the user.
Imagine you're appending `x` to `myList`:

- **Don't do** `<button onClick={() => setMyList([...myList, x])} />`, because:
  1.  You have now created a new function that captures the _current_ state of `myList` _during render_, and overwrites the entire list with that. If you have any other action in that same render cycle that changes another part of the list like `myList[0] = "new"`, this change would get lost.
  2.  You have coupled the actual _implementation logic_ of that action in the UI.
- **Instead, do** `<button onClick={() => appendToMyList(x)} />`.

##### 2. Selecting too much state in react components

Only select exactly what you need to render this component, not more, e.g.

- if you render just the element `i`, then select only `array[i]`
- if you only need the size, then select only `array.length`

##### 3. Constructing new objects in selectors for multiple values

Since you'd be constructing a new object each time, its identity would not be stable, leading to a re-render on every (unrelated) state update. Instead, just select the values individually or [`useShallow`](https://zustand.docs.pmnd.rs/hooks/use-shallow).
_(But if you select a nested object inside the state, then it'd be ok: The identity stays stable unless it or any of its parts was actually changed)_

##### 4. Passing around state as prop to child components

If the child component is a completely generic one, sure. But if it's actually coupled to the specific store like `<NoteList>` then you should just be selecting the required store state inside it.

##### 5. Abuse of `useEffect` for computed values

Use selector for this. If your computed result is not a primitive, then remember to mind the unstable identity problem for re-render optimization.
Of course you can also just do it within the component directly, if you e.g. need both the original value and the computed value.
_(`useEffect` really is just for "side-effects" outside of react, like APIs!)_

### 3. Rendering your state

Inside React components or hooks, you need to access (some part of) the state, in order to render it and re-render it when it changes.

**Selector**: a function that is given the current store state and returns (selects) only the parts we are interested in. It's just a function, you can compose it, chain it, whatever you need.

###### Q: How about computed states?

Selectors are basically already computed states, just apply your calculation and return it. If it's super expensive, you can memoize your selector using [reselect](https://github.com/reduxjs/reselect). Only do it when the profiler shows that you actually need it.
Just like actions, you can put the selector in the store or outside.

## Common usage patterns

### 1. Defining state and actions

#### 1A. Recommended in docs: Actions inside the store

One "quirky" thing about Zustand is that it's a common pattern to include the action functions as part of the state itself, even though it's not really "data":

```
const useMyStore = create<MyState & MyActions>()(
	(set) => ({
		// states
		myInt: 0,
		myList: [],
		// actions
		increment: () => {set((state) => ({ myInt: state.myInt + 1 }))}
	})
)

function MyComponent() {
	const myInt = useMyStore((s) => s.myInt);
	const increment = useMyStore((s) => s.increment);
	return <button onClick={increment}> Increment {myInt} by 1 </button>
}
```

- **Store type**: includes the action types
- **Action location**: right inside the store, just like the states
- **Store access from actions**: via the `set`, `get` and `store` passed from the state creator
- **Store access from outside**: not possible, but the `useMyStore` hook has the store API attached, including those attached by middlewares.
- **Calling the action**: requires selecting the actions to use it (even though it will never change), just like states.

#### 1B. Personal preference: Actions outside of the store

```
const useMyStore = create<MyState>()(
	() => ({
		// states
		myInt: 0,
		myList: [],
	})
)

// actions
const increment = () => {useMyStore.setState((state) => ({ myInt: state.myInt + 1 }))}

function MyComponent() {
	const myInt = useMyStore((s) => s.myInt);
	return <button onClick={increment}> Increment {myInt} by 1 </button>
}
```

- **Store type**: is simply the state type
- **Action location**: is outside the store, theoretically anywhere.
- **Store access from actions**: use the store API attached to the `useMyStore` hook.
- **Store access from outside**: not possible, but the `useMyStore` hook has the store API attached, including those attached by middlewares.
- **Calling the action**: simply by importing that action directly (no selector)

- More flexible, but kinda blurs the line: Action can be declared anywhere, can set different stores, etc. Can be powerful but dangerous.
- Nice to have: Resetting the store via `set(newState, true)` will not accidentally clear actions.

> **Drawback**: If you have multiple instances of the same store (with a provider), now your actions do not make sense. In this case, having the actions inside the store makes more sense.

### 2. Selecting state in React components

use selectors
Selectors are just functions that take in state and return a part of that state.
Common selectors can be reused, because they're just functions:
`useMyStore(select)`

## Our internal Zustand best practices

### Actions outside of store

see above

### Use Immer for "mutable" state setters

The Immer middleware changes the store setter to also allow draft state mutation (without requiring it). There's very little reason to not use it!

### Typing

Tbh, Zustand's typescript support is a bit shaky, but it does work.

Recommended:

- Define the state interface explicitly
-

Not recommended:

- `combine()`: Can automatically infer the state type from the initial state. But 99% of the time, we want explicit state type interface anyways, so no reason to use this.

## WS-Sync Integration

### Motivation: symmetric state + actions

WS‑Sync provides a simple, mostly symmetric protocol for two peers to:

- keep a shared state in sync (via patches), and
- call remote procedures (via actions).

It’s modeled after reducers/Redux/Zustand: one central state and UI‑initiated actions that modify it. “Mostly symmetric” means the protocol itself doesn’t force server/client roles; practically, the backend often owns the ground‑truth state while the frontend views and sends actions. Picking a ground truth per store (or per field) avoids hard merge conflict problems.

Under the hood, local updates are converted to Immer patches and sent over a persistent `Session` (WebSocket). Remote `_SET` and `_PATCH` updates apply back into your Zustand store and trigger normal re‑renders.

### 1. Create a Session

```ts
import { Session } from "ws-sync";

export const session = new Session("ws://localhost:8000/ws");
session.connect();
session.disconnect();
```

### 2. Create a synced store

```ts
import { create } from "zustand";
import { synced } from "ws-sync";

type Note = { id: string; title: string; content: string };
type Notes = { notes: Note[]; currentNoteIndex: number | null };

export const useNotes = create<Notes>()(
  synced((set, get, store) => ({ notes: [], currentNoteIndex: null }), {
    key: "Notes",
    session,
  })
);
// The middleware attaches `sync` (callable) with helpers to the store API.
```

### 3. Local actions (frontend owns the state)

Local updates use normal `set` calls. The middleware captures Immer patches and sends them when you call `sync()`.

```ts
const { setState: set, sync } = useNotes;

export const select = (index: number | null) => {
  set({ currentNoteIndex: index });
  sync();
};
```

When the frontend is the ground truth, this is all you need. Essentially you're just updating the state locally as usual, and the server will also update their version of the state the same way, which keeps them in sync.

> For frequently updated fields, you can debounce the sync: `sync({ debounceMs: 500 })`, and if you want to ensure that the states don't diverge for too long, you can additionally add a max wait time: `sync({ debounceMs: 500, maxWaitMs: 1000 })`. This will only update after 0.5s of inactivity, but will never be out-of-sync for more than 1s.

### 4. Remote delegators (backend owns the state)

If the backend owns the state, generate delegates that send actions to the server; the server applies changes and sends patches back.

```ts
import { NotesActionsKeys, type NotesActionsParams } from "../client";

export const notesRemote = useNotes.sync.createDelegators<NotesActionsParams>()(
  {
    add: NotesActionsKeys.append,
    update: NotesActionsKeys.updateNote,
    reset: NotesActionsKeys.resetAll,
  }
);

notesRemote.add({ note }); // { type: "append", note }
```

Round‑trip: UI calls a delegate → server updates state → server emits `_PATCH`/`_SET` → store updates → React re‑renders.

### 5. Expose client functions (server can call)

Let the server trigger UI behaviors (e.g. scroll):

```ts
useNotes.sync.useExposedActions({
  scrollToTop,
  SCROLL_TO_BOTTOM: scrollToBottom,
});
```

### 6. Render with selectors (nothing special)

Use standard Zustand selectors; syncing is transparent to React.

```tsx
const title = useNotes((s) => s.notes[i]?.title ?? "");
```

### Ownership and conflict notes

- Decide ground truth per store or per field. Avoid both sides editing the same field concurrently.
- You can mix: some actions local (client‑owned), others remote (server‑owned).
- High‑frequency edits: use `debounceMs` and `maxWaitMs` when calling `sync()`.

### API cheatsheet (concise)

- **synced(stateCreator, { key, session, sendOnInit? })**: apply middleware
- **sync(params?)**: flush local patches (supports `debounceMs`, `maxWaitMs`)
- **sync.createDelegators<KeyToParams>()(nameToKey)**: build remote action callers
- **sync.registerExposedActions(handlers)** / **sync.useExposedActions(handlers)**: let server trigger client functions
- **sync.fetchRemoteState()** / **sync.sendState(state)**: pull/push full state
- **sync.sendAction(action)** / **sync.sendBinary(action, data)** / **startTask/cancelTask**: low-level messaging helpers
- **sync.useIsSynced()**: boolean hook for "no pending patches"

### Tips

- Prefer granular `set` updates; patches stay small and efficient.
- Use `debounceMs` with `maxWaitMs` for text inputs (smooth UX, bounded latency).
- One store per logical domain; unique `key` per store/instance to avoid collisions.

### Troubleshooting

- No updates? Check `key` matches server and that the `Session` is connected.
- Duplicate exposed handler error? Keep and call the cleanup, or use `useExposedActions` with stable handler identity.
- Delegates not firing the right action? Verify your `nameToKey` mapping matches backend keys.

### End-to-end wiring

- Create a single `Session` for your app and either:
  - Provide it via `SessionProvider` and use `DefaultSessionContext`, or
  - Pass it directly in `SyncOptions.session`.
- Use one `key` per logical store. If you create multiple instances of the same store, give each a unique key to avoid wire collisions.
- Connect the session on app mount and disconnect on unmount.

```tsx
import { Session, SessionProvider } from "ws-sync";

const session = new Session("ws://localhost:8000/ws");

export function App() {
  useEffect(() => {
    session.connect();
    return () => session.disconnect();
  }, []);
  return (
    <SessionProvider value={session}>
      {/* your routes/components */}
    </SessionProvider>
  );
}
```

### Typing recommendations

- Define explicit state interfaces. Prefer actions outside the store for clarity and testability.
- The middleware augments the store with a `sync` field via a Zustand mutator. You can access it on the store API: `useStore.sync` (hook with attached store API) or `store.sync` inside the creator.
- If you need to type delegates, use the exported `Actions` helper type from `ws-sync` to infer the mapping type (usually unnecessary if using `const` inference).

```ts
import type { Actions } from "ws-sync";

// Build typed delegates
const delegate = useStore.sync.createDelegators<NotesActionsParams>()({
  add: NotesActionsKeys.append,
});
// type of delegate is inferred and can be re-used
type NotesRemote = typeof delegate;
```

### Delegators deep dive

`sync.createDelegators<KeyToParams>()(nameToKey)` produces a record of functions that forward to `sync.sendAction()`.

- `KeyToParams` is an object type describing the backend action keys mapped to each action's parameter shape.
- `nameToKey` maps local function names to backend action keys.
- If a delegate is called with `undefined`/`null` it sends just `{ type }`. Otherwise, it spreads the object fields after `type`.

Example shapes:

```ts
// On the wire (backend contract)
type NotesActionsParams = {
  append: { note: Note };
  resetAll: {};
  updateNote: { index: number; note: Note };
};

// Build local names → backend keys mapping
const delegate = sync.createDelegators<NotesActionsParams>()({
  add: "append",
  reset: "resetAll",
  update: "updateNote",
});

delegate.add({ note }); // sends { type: "append", note }
delegate.reset(); // sends { type: "resetAll" }
```

### Exposed actions deep dive

- Use `sync.registerExposedActions(handlers)` to let the backend call client-side functions.
- Keys default to function names. To customize, set object keys explicitly.
- Re-registering the same key throws; keep the cleanup function and call it when unmounting.

```ts
const cleanup = sync.registerExposedActions({
  scrollToTop,
  SCROLL_TO_BOTTOM: scrollToBottom,
});

// later
cleanup();
```

Within React components prefer `sync.useExposedActions(handlers)` to auto clean up based on dependencies (the handler object identity):

```ts
// Important: memoize handlers to avoid unnecessary re-registrations
const handlers = useMemo(
  () => ({ scrollToTop, SCROLL_TO_BOTTOM: scrollToBottom }),
  [scrollToTop, scrollToBottom]
);
sync.useExposedActions(handlers);
```

### Sync lifecycle (what happens on each change)

1. You call `set` with either a function updater (Immer) or an object.
2. The middleware captures patches:
   - Function updaters run in Immer `produceWithPatches`, emitting granular patches.
   - Object updaters are converted into `replace` patches per field.
3. Patches are stored in the `Sync` buffer. The first patch also captures a base snapshot for later compression.
4. You call `sync()`:
   - With no `debounceMs` → immediate flush.
   - With `debounceMs`/`maxWaitMs` → schedule timers; coalesce while typing.
5. On flush:
   - If buffer size >= `compressThreshold` and base snapshot exists → patches are compressed via Immer to a minimal equivalent set.
   - Patches are converted to JsonPatch and sent via `_PATCH:<key>`.
   - Buffer clears, `useIsSynced()` flips to `true`.
6. Remote updates:
   - `_SET:<key>` replaces state.
   - `_PATCH:<key>` applies json patches to the current state.
   - `_ACTION:<key>` resolves to exposed handlers first; otherwise looks up `state[action.type]` and invokes if it’s a function.

### Performance and consistency notes

- Granular updates are cheaper to synchronize than whole-object replacements.
- For high-frequency inputs, use `debounceMs` and a reasonable `maxWaitMs` to get smooth UX and timely network flushes.
- Compression reduces wire size by collapsing many local edits into a minimal set; disable via `sync.obj.compressThreshold = null` if necessary (e.g. debugging).
- Conflict handling is application-specific. Server `_PATCH` applies over the current client state; if both sides edit the same field concurrently, last writer wins visually. Design server logic to resolve conflicts and emit authoritative patches.
- `useExposedActions` depends on the identity of the `handlers` object—memoize it to avoid churn.

### Troubleshooting & FAQ

- "My store doesn’t change when the server sends data": Ensure `key` matches on both sides and the session is connected. Verify `_SET:<key>`/`_PATCH:<key>` events are registered.
- "I get action handler already registered": You attempted to register the same exposed key twice. Keep and call the cleanup function, or use `useExposedActions` with stable handler identity.
- "Delegates send wrong keys": Check your `nameToKey` mapping. The right-hand side must match backend action keys exactly.
- "I never flush": You called `sync({ debounceMs })` when there were no local patches; schedule flush only after a `set` happens. Alternatively, call `sync()` after each local change.
- "StrictMode double effects": If your session connects twice in dev, guard with a ref or connect in a root not wrapped by double-invocation. Avoid creating sessions inside components.
- "Multiple instances collide": Give each instance a unique `key`.
- "Disable UI while syncing?": Use `const isSynced = sync.useIsSynced()` and disable buttons/indicators while `!isSynced`.

```tsx
const isSynced = useNotesStore.sync.useIsSynced();
<button disabled={!isSynced}>Save</button>;
```

### Migration notes (from reducers/dispatch)

- Replace `dispatch({ type, ...payload })` with either:
  - Locally implemented actions that call `set` and then `sync()`; or
  - Remote delegates produced via `sync.createDelegators()`.
- Server-initiated effects that were previously special-cased can become exposed actions.
- Full state replace maps to `sync.sendState(state)`; fetch maps to `sync.fetchRemoteState()`.

### File organization suggestions

- `stores/notes.ts`: state definition + `createSyncedStoreHook` factory usage
- `actions/notes.remote.ts`: `sync.createDelegators()` + optional overrides
- `actions/notes.local.ts`: local `set`/`sync()` actions
- `components/Notes/*.tsx`: components that select the smallest necessary state
