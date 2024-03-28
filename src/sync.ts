import { useReducer, useContext, useEffect, useMemo } from "react"
import { applyReducer, deepClone } from "fast-json-patch"
import { Session, DefaultSessionContext } from "./session"
import { castImmutable, produceWithPatches, enablePatches } from "immer"
enablePatches()


const setEvent = (key: string) => "_SET:" + key
const getEvent = (key: string) => "_GET:" + key
const patchEvent = (key: string) => "_PATCH:" + key
const actionEvent = (key: string) => "_ACTION:" + key
const taskStartEvent = (key: string) => "_TASK_START:" + key
const taskCancelEvent = (key: string) => "_TASK_CANCEL:" + key


export type Action = {
  type: string
} & Record<string, any>

export type TaskStart = {
  type: string
} & Record<string, any>

export type TaskCancel = {
  type: string
}

// sync object that can calculate the json patch and send it to remote
export type Sync<S> = () => void
export type Delegate = (actionOverride?: Action) => void
export type SyncedReducer<S> = (draft: S, action: Action, sync: Sync<S>, delegate: Delegate) => S | void


export function useSyncedReducer<S>(
  key: string,
  syncedReducer: SyncedReducer<S> | undefined,
  initialState: S,
  overrideSession: Session | null = null,
  sendOnInit = false
): [any, (action: Action) => void] {
  const session = overrideSession ?? useContext(DefaultSessionContext)

  // Syncing: Local -> Remote
  const fetchRemoteState = () => {
    session?.send(getEvent(key), {})
  }
  const sendState = (newState: S) => {
    session?.send(setEvent(key), newState)
  }
  const sendPatch = (patch: any) => {
    session?.send(patchEvent(key), patch)
  }
  const sendAction = (action: Action) => {
    session?.send(actionEvent(key), action)
  }
  const startTask = (task: TaskStart) => {
    session?.send(taskStartEvent(key), task)
  }
  const cancelTask = (task: TaskCancel) => {
    session?.send(taskCancelEvent(key), task)
  }
  const sendBinary = (action: Action, data: ArrayBuffer) => {
    session?.sendBinary(actionEvent(key), action, data)
  }


  // Dynamically create setters and syncers for each attribute
  const setters = useMemo(
    () => Object.keys(initialState as object).reduce((acc, attr) => {
      const upper = attr.charAt(0).toUpperCase() + attr.slice(1)

      const setState = (newValue: any) => {
        const patch = [{ op: "replace", path: `/${attr}`, value: newValue }]
        patchState(patch) // local update
      }
      const syncState = (newValue: any) => {
        const patch = [{ op: "replace", path: `/${attr}`, value: newValue }]
        patchState(patch) // local update
        sendPatch(patch) // sync to remote
      };

      acc[`set${upper}`] = setState
      acc[`sync${upper}`] = syncState
      return acc
    }, {} as Record<string, (v: any) => void>),
    [initialState])

  // State Management
  // reducer must be wrapped to handle the remote events, and also return a queue of side effects to perform, i.e. sync and sendAction
  const wrappedReducer = ([state, _]: [S, any[]], action: Action): [S, any[]] => {
    switch (action.type) {

      case setEvent(key): {
        const newState = action.data
        return [newState, []]
      }

      case patchEvent(key): {
        const patch = action.data
        const newState = patch.reduce(applyReducer, deepClone(state))
        return [newState, []]
      }

      default: {
        if (!syncedReducer) {
          return [state, []]
        }
        // sync and delegate enqueues the patch and action to be sent to the remote, will actually be executed in the useEffect after the reducer
        const createEffect: any[] = []
        const sync = () => {
          createEffect.push((patch: any[]) => () => {
            if (patch.length > 0) {
              //convert "Immer" patches to standard json patches
              patch.forEach((p) => {
                // if path is an array, join it into a string
                if (Array.isArray(p.path)) {
                  p.path = p.path.join("/")
                }
                // if it does not start with /, add it
                if (!p.path.startsWith("/")) {
                  p.path = "/" + p.path
                }
              })
              sendPatch(patch)
            }
          })
        }
        const delegate = (actionOverride?: Action) => {
          createEffect.push((patch: any[]) => () => {
            sendAction(actionOverride ?? action)
          })
        }
        const withPatch = produceWithPatches(syncedReducer)
        const [newState, patch, inverse] = withPatch(castImmutable(state), action, sync, delegate)
        return [newState, createEffect.map((f) => f(patch))]
      }
    }
  }

  // The underlying state holder and reducer
  const [[state, effects], dispatch] = useReducer(wrappedReducer, [initialState, []])

  // Execute the side effects (after render)
  useEffect(() => {
    effects.forEach((f) => f())
    // clear the effects
    effects.splice(0, effects.length)
  })

  // Syncing: Remote -> Local
  // callbacks to handle remote events
  const setState = (newState: S) => {
    dispatch({ type: setEvent(key), data: newState })
  }
  const patchState = (patch: any) => {
    dispatch({ type: patchEvent(key), data: patch })
  }
  const actionState = (action: Action) => {
    dispatch(action)
  }

  useEffect(() => {
    session?.registerEvent(getEvent(key), () => sendState(state)) //TODO: closure correct?
    session?.registerEvent(setEvent(key), setState)
    session?.registerEvent(patchEvent(key), patchState)
    session?.registerEvent(actionEvent(key), actionState)
    if (sendOnInit) {
      // Optionally, send the initial state or an initial action
      session?.registerInit(key, () => sendState(state))
    }

    return () => {
      session?.deregisterEvent(getEvent(key))
      session?.deregisterEvent(setEvent(key))
      session?.deregisterEvent(patchEvent(key))
      session?.deregisterEvent(actionEvent(key))
      if (sendOnInit) {
        session?.deregisterInit(key)
      }
    }
  }, [session, key])

  // expose the state with setters and syncers
  const stateWithSync = {
    ...state,
    ...setters,
    fetchRemoteState, // explicitly fetch the entire state from remote
    sendAction,
    startTask,
    cancelTask,
    sendBinary,
  }

  return [stateWithSync, dispatch]
}

export function useSynced<S>(
  key: string,
  initialState: S,
  overrideSession: Session | null = null,
  sendOnInit = false
) {
  const [stateWithSync, dispatch] = useSyncedReducer(key, undefined, initialState, overrideSession, sendOnInit)
  return stateWithSync
}
