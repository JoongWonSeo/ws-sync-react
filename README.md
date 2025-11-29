# ws-sync

This library defines a very simple WebSocket and JSON & JSON Patch based protocol for keeping the backend and the react frontend in sync. There's a corresponding [python library](https://github.com/JoongWonSeo/ws-sync) that implements the backend side of the protocol.

## Philosophy

Following Zustand's philosophy: **keep as much complex app state in pure JavaScript as possible**, so that React can focus on being pure UI rather than having all the complex state logic inside components. This means:

- State and actions live outside React components
- React components select only what they need to render
- Syncing with the backend is transparent to React

## Quick Start

Install the package:

```bash
npm install ws-sync zustand
```

### 1. Create a global Session

The `Session` is a pure JavaScript object that manages the WebSocket connection:

```typescript
// session.ts
import { Session } from "ws-sync";
import { toast } from "sonner";

export const session = new Session({
  url: "ws://localhost:8000/ws",
  label: "Backend",
  toast, // optional: for connection notifications
});

// Connect when your app starts
session.connect();
```

### 2. Create a synced store

Use Zustand's `create()` with the `synced()` middleware:

```typescript
// stores/notes.ts
import { create } from "zustand";
import { synced } from "ws-sync";
import { session } from "./session";

type Note = { id: string; title: string; content: string };
type Notes = { notes: Note[]; currentNoteId: string | null };

export const useNotes = create<Notes>()(
  synced(
    () => ({
      notes: [],
      currentNoteId: null,
    }),
    {
      key: "Notes",
      session,
    }
  )
);
```

### 3. Use in React components

Select only what you need to render:

```tsx
import { useNotes } from "./stores/notes";

function NotesList() {
  const notes = useNotes((s) => s.notes);
  const currentId = useNotes((s) => s.currentNoteId);

  return (
    <ul>
      {notes.map((note) => (
        <li key={note.id} className={note.id === currentId ? "active" : ""}>
          {note.title}
        </li>
      ))}
    </ul>
  );
}
```

## State Updates with Immer

The `synced` middleware includes Immer, which lets you write "mutating" code that's actually immutable. **For complex or nested state updates, Immer generates more efficient JSON patches** that get synced over the WebSocket.

```typescript
const { setState: set, sync } = useNotes;

// Simple object update (shallow merge)
set({ currentNoteId: "note-1" });

// Immer-style mutation (for nested updates)
set((draft) => {
  const note = draft.notes.find((n) => n.id === "note-1");
  if (note) {
    note.title = "Updated Title";
  }
});

// After updating, sync to backend
sync();
```

The Immer approach generates precise JSON patches like `[{ op: "replace", path: "/notes/0/title", value: "Updated Title" }]` instead of sending the entire `notes` array.

## The `sync` API

The `synced` middleware attaches a `sync` object to your store with helpful methods:

```typescript
// Access it from the hook
const sync = useNotes.sync;

// Or inside the state creator
const useNotes = create<Notes & NotesActions>()(
  synced(
    (set, get, store) => ({
      // store.sync is available here
      notes: [],
      currentNoteId: null,
      selectNote: (id: string | null) => {
        set({ currentNoteId: id });
        store.sync();
      },
    }),
    { key: "Notes", session }
  )
);
```

### Flush local changes

Call `sync()` after local updates to send patches to the backend:

```typescript
const { setState: set, sync } = useNotes;

export const selectNote = (id: string | null) => {
  set({ currentNoteId: id });
  sync(); // send patch to backend
};

// For frequently updated fields, debounce:
export const updateNoteContent = (id: string, content: string) => {
  set((draft) => {
    const note = draft.notes.find((n) => n.id === id);
    if (note) note.content = content;
  });
  sync({ debounceMs: 500, maxWaitMs: 1000 }); // send every 0.5s - 1s
};
```

### Remote actions (backend-owned state)

When the backend owns the state, create delegators that send actions to the server:

```typescript
// generated types from your backend
import { NotesActionsKeys, type NotesActionsParams } from "./api/types";

const { sync } = useNotes;

export const notesRemote = sync.createDelegators<NotesActionsParams>()({
  add: NotesActionsKeys.addNote,
  remove: NotesActionsKeys.removeNote,
  archive: NotesActionsKeys.archiveNote,
});

// Usage
notesRemote.add({ note: { id: "1", title: "New Note", content: "" } });
// sends: { type: "addNote", note: { ... } }
```

The backend processes the action, updates state, and sends patches back. The store updates and React re-renders.

### Exposed actions (server can call client)

Let the backend trigger client-side behaviors:

```typescript
const { sync } = useNotes;

// In a component
sync.useExposedActions({
  scrollToNote: (noteId: string) => {
    document.getElementById(noteId)?.scrollIntoView();
  },
  showNotification: (message: string) => {
    toast.info(message);
  },
});
```

### Other useful methods

```typescript
sync.fetchRemoteState(); // Request full state from backend
sync.sendState(state); // Push full state to backend
sync.useIsSynced(); // Hook: true when no pending patches
sync.sendBinary(action, data); // Send binary data with action
sync.startTask(task); // Start cancellable background task
sync.cancelTask(taskType); // Cancel running task
```

## Actions Pattern

Unlike the Zustand doc's recommendation, we recommend defining actions **outside the store**:

```typescript
// stores/notes.ts
import { create } from "zustand";
import { synced } from "ws-sync";
import { session } from "./session";

type Note = { id: string; title: string; content: string };
type Notes = { notes: Note[]; currentNoteId: string | null };

// State-only store
export const useNotes = create<Notes>()(
  synced(() => ({ notes: [], currentNoteId: null }), { key: "Notes", session })
);

// ========== Actions ========== //
const { setState: set, sync } = useNotes;

// Local actions (frontend owns these fields)
export const selectNote = (id: string | null) => {
  set({ currentNoteId: id });
  sync();
};

export const updateNoteLocally = (
  id: string,
  title: string,
  content: string
) => {
  set((draft) => {
    const note = draft.notes.find((n) => n.id === id);
    if (note) {
      note.title = title;
      note.content = content;
    }
  });
  sync({ debounceMs: 500 });
};

// Remote actions (backend owns these operations)
import { NotesActionsKeys, type NotesActionsParams } from "./api/types";

export const notesRemote = sync.createDelegators<NotesActionsParams>()({
  add: NotesActionsKeys.addNote,
  remove: NotesActionsKeys.removeNote,
  save: NotesActionsKeys.saveNote,
});
```

Usage in components:

```tsx
import {
  useNotes,
  selectNote,
  updateNoteLocally,
  notesRemote,
} from "./stores/notes";

function NoteEditor() {
  const note = useNotes((s) => s.notes.find((n) => n.id === s.currentNoteId));
  const isSynced = useNotes.sync.useIsSynced();

  return (
    <div>
      <input
        value={note?.title ?? ""}
        onChange={(e) =>
          updateNoteLocally(note!.id, e.target.value, note!.content)
        }
      />
      <textarea
        value={note?.content ?? ""}
        onChange={(e) =>
          updateNoteLocally(note!.id, note!.title, e.target.value)
        }
      />
      <button
        onClick={() => notesRemote.save({ noteId: note!.id })}
        disabled={!isSynced}
      >
        Save to Backend {isSynced ? "✓" : "⏳"}
      </button>
    </div>
  );
}
```

This has a few advantages:

- Directly import the action, no need to select it
- Store type only includes the state, not the actions
- No need to worry about action identity
- No way to accidentally remove the action from the store
- No need to filter them out when syncing, persisting, etc.
- Can split actions into different locations
- Easier for one action to call another action, even for other stores
- Makes it inherently clear that actions are nothing more than functions that mutate the state

However, there are some cases where in-store actions are useful:

- When you have dynamic stores (see below), the actions need to be created dynamically, since you need to differentiate between the actions of different stores
- Maybe you need to swap out the action implementation, i.e. the action itself is a state, so it'd make sense to keep it in the store

## Advanced Patterns

### Helper for multiple middlewares

When using multiple Zustand middlewares (devtools, persist, immer, synced), you can create a helper to avoid deeply nested wrapping:

```typescript
// store-config.ts
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { synced, type SyncOptions } from "ws-sync";

export function createSyncedStore<State>({
  initialState,
  syncOptions,
  persistOptions,
  devtoolsOptions,
}: {
  initialState: State;
  syncOptions: SyncOptions;
  persistOptions?: any;
  devtoolsOptions?: any;
}) {
  return create<State>()(
    devtools(
      persist(
        synced(() => initialState, syncOptions),
        persistOptions ?? {
          name: "DISABLED",
          partialize: () => ({}),
          skipHydration: true,
        }
      ),
      devtoolsOptions
    )
  );
}

// Usage
export const useNotes = createSyncedStore<Notes>({
  initialState: { notes: [], currentNoteId: null },
  syncOptions: { key: "Notes", session },
  persistOptions: { name: "notes-cache" },
  devtoolsOptions: { name: "NotesStore" },
});
```

### Separating synced vs local state

Use `syncAttributes` to specify which fields should sync. Other fields stay local:

```typescript
interface LocalState {
  isEditorOpen: boolean;
  selectedTab: "edit" | "preview";
}

export const useNotes = create<Notes & LocalState>()(
  synced(
    () => ({
      // synced state
      notes: [],
      currentNoteId: null,
      // local state (never synced)
      isEditorOpen: false,
      selectedTab: "edit",
    }),
    {
      key: "Notes",
      session,
      syncAttributes: ["notes", "currentNoteId"], // only sync these fields
    }
  )
);
```

### Dynamic stores with providers

For apps that need multiple instances of the same store (e.g., chat rooms, collaborative documents), create stores dynamically:

```typescript
import { createStore, useStore } from "zustand";
import { create } from "zustand";

// Factory function
export const createChatStore = (roomId: string) =>
  createStore<ChatRoom>()(
    synced(() => ({ messages: [], members: [] }), {
      key: `ChatRoom:${roomId}`,
      session,
    })
  );

// Registry to manage instances
interface ChatRegistry {
  rooms: Record<string, ReturnType<typeof createChatStore>>;
}

export const useChatRegistry = create<ChatRegistry>(() => ({ rooms: {} }));

// Hook to access a specific room
export const useChatRoom = <T>(
  roomId: string,
  selector: (s: ChatRoom) => T
) => {
  const registry = useChatRegistry((s) => s.rooms);

  // Create store on first access
  if (!registry[roomId]) {
    useChatRegistry.setState((s) => {
      s.rooms[roomId] = createChatStore(roomId);
    });
  }

  return useStore(registry[roomId], selector);
};
```

## Development & Publishing

After you make changes (don't forget to bump the version number!), run the following commands to publish the changes to npm:

```bash
npm run build
npm publish
```

For more details on the Zustand integration and advanced patterns, see [docs/zustand.md](docs/zustand.md).
