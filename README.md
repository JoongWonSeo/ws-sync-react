# ws-sync

This library defines a very simple WebSocket and JSON & JSON Patch based protocol for keeping the backend and the react frontend in sync. There's a corresponding [python library](https://github.com/JoongWonSeo/ws-sync) that implements the backend side of the protocol.


## Quick Start

Install the package:

```bash
npm install ws-sync
```

A simple synced component looks like this:

```javascript
import { useSynced, SessionProvider } from 'ws-sync'
import { Toaster, toast } from 'sonner'

const Notes = () => {
  const notes = useSynced("NOTES", {
    title: "temp initial notes",
    notes: ["these values", "are only shown", "until the websocket connects"],
  })

  return (
    <div>
      <h1>{notes.title}</h1>
      <input value={notes.title} onChange={e => notes.syncTitle(e.target.value)} />
      <ul>{notes.notes.map(note => <li>{note}</li>)}</ul>
    </div>
  )
}

function App() {
  return (
    <SessionProvider
      url="ws://localhost:8000/ws"
      toast={toast}
      autoconnect
    >
      <Notes />
      <Toaster />
    </SessionProvider>
  );
}

export default App;
```

- The `useSynced` hook is used like `useState`, but it syncs the state with the server.
- The `SessionProvider` component is used to define the WebSocket connection, and the `toast` function is from the [sonner](https://sonner.emilkowal.ski/) library, which is used to show toast notifications (not required, but recommended).


### The `useSynced` hook

Where you'd normally use `useState`, use `useSynced` instead, if you want the state to be synced with the server. The first argument is the key to use to identify the state (should match the backend key), and the second argument is the initial state, which is used before the synced state is received (but also useful to easily understand the shape of the state).

The object returned by `useSynced` has:

- **All the properties** as defined by the initial state, but then overwritten by the synced state from the server. Therefore, you should ensure that the backend sends all the properties that you expect.

- For each property `myProp`:
    - a **setter function `setMyProp(x)`**, which locally updates the property, exactly like with `useState`, and
    - a **syncer function `syncMyProp(x)`**, which locally updates the property **and sends the update to the server**, such that it is automatically updated in the backend as well.

- Some additional functions that are always available:
    - `sendAction({type: "MY_ACTION", my_arg: "my_values", arg2: 123})`:  
    Essentially like calling a function on the backend, with the matching action key and keyword arguments. The backend should have a corresponding action handler for this action key.  
    An action is "blocking the backend", i.e. the backend will not process any other actions until this action is completed. This guarantees a sequential order of actions. However, *sending an action* is not blocking the frontend, i.e. this function call **does not wait for the action to be completed**.

    - `startTask({type: "MY_TASK", my_arg: "my_values", arg2: 123})`:  
    Similar to actions, but for long-running tasks, i.e. it's non-blocking for the backend and cancellable.

    - `cancelTask({type: "MY_TASK"})`:  
    Cancel a task that was started with `startTask`.

    - `sendBinary({type: "MY_ACTION", my_arg: 123}, data)`:  
    Like `sendAction`, but sends binary data alongside the action. The backend should have a corresponding action handler with a `data` parameter.

    - `fetchRemoteState()`:  
    Explicitly request a fetch of the (entire) backend state. You rarely have to manually call this, as the backend will (by default) automatically send the state when the connection is established[^1].
    
- Finally, if the backend opted to expose it, a list of currently running tasks (their keys) is available as `runningTasks`. If using this, don't forget to add `runningTasks` to the initial state as well.

[^1]: One case where you need this is when this component is mounted after the connection is established.


### The `useSyncedReducer` hook

Usually, the state is "owned" and managed by the backend, and the frontend is often just a "dumb" renderer of the state, with barely any state-maniuplation logic. However, for better latency and user experience, it is often useful to have some state-manipulation logic on the frontend side as well. Or, sometimes, the backend must trigger some actions in the frontend, rather than just updating the state to be rendered (e.g. show an alert box). This is where the `useSyncedReducer` hook comes in.

This is a more advanced hook, similar to the `useReducer` hook, where you define a reducer function that handles all the actions. The reducer function is called with the current state, the action (triggered by either `sendAction`, `startTask`, `cancelTask`, or `sendBinary`, OR directly triggered by the backend), and the `sync` and `delegate` functions.

While the first two arguments are the same as with `useReducer`, the `sync` function can be called to sync the state with the server, and the `delegate` function can be used to delegate the action to the backend. This give you an explicit control over *where the action is processed*. This is important that you clearly decide which actions are processed locally and which are processed on the backend, in order to prevent an infinite loop of delegating actions back and forth, or to prevent the frontend from getting out of sync with the backend.

The reducer function is actually like [the immer library's `useImmerReducer` hook](https://immerjs.github.io/immer/example-setstate#useimmerreducer), so you can directly modify the state, instead of returning a new state.

```javascript
const reduceNotes: SyncedReducer<Notes> = (notes, action, sync, delegate) => {
  switch (action.type) {
    // ========== backend triggered -> locally processed ========== //
    case "SCROLL_TO_BOTTOM":
      window.scrollTo(0, document.body.scrollHeight)
      break

    // ========== locally triggered -> locally processed ========== //
    case "ADD_NOTE":
      notes.notes.push(action.note)
      sync() // update the backend
      break
    case "REMOVE_NOTE":
      notes.notes.splice(action.index, 1)
      sync() // update the backend
      break
    
    // ========== locally triggered -> delegated to the backend ========== //
    case "REVERSE_NOTES":
    case "DO_SOMETHING_ELSE":
      delegate() // the actions are simply delegated to the backend
      break
  }
}
```

Again to emphasize: actions should be either locally processed or delegated to the backend, and you should clearly separate them in your reducer function. The `sync` function should be called after you've modified the state locally, and the `delegate` function should be called if you want the backend to process the action.

Note that if an action is only ever *processed* on the frontend, you don't need to define it in the backend. But if an action is *triggered* by the frontend, then you always need to handle it in the reducer function, since *every action* is handled by the reducer function.

In short, the reducer function is the immediate handler of all actions, no matter whether triggered locally or remotely, and it decides where (and how) the action is processed.


### The `SessionProvider` component

This is usually just done once in the root component of your app, and it provides the WebSocket connection to the backend. The `url` prop is the URL of the WebSocket server, and the `toast` prop is a function that is used to show toast notifications.


### The `useRemoteToast` hook

This simple hook enables the backend to show toast notifications on the frontend.


### Zustand integration

For applications that already rely on [Zustand](https://github.com/pmndrs/zustand)
for state management, the library exposes helpers to create synced stores
outside of React components.

```javascript
import { createSyncedStore, Session } from 'ws-sync'
import { create } from 'zustand'

const session = new Session('ws://localhost:8000/ws')

// Create a vanilla store and then bind it with the Zustand `create` helper
const notesStore = createSyncedStore('NOTES', { title: '', notes: [] }, session)
export const useNotes = create(notesStore)

// Anywhere in your app you can use the store
useNotes.getState().syncTitle('new title')
```


## Development & Publishing

After you make changes (don't forget to bump the version number!), run the following commands to publish the changes to npm:

```bash
npm run build
npm publish

For more details on how the provider and hooks are organised see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
