import { createStore, StoreApi } from 'zustand/vanilla'
import { applyReducer, deepClone } from 'fast-json-patch'
import { castImmutable, produceWithPatches, enablePatches } from 'immer'
import { Session } from './session'
import { Action, TaskCancel, TaskStart, SyncedReducer, StateWithSync } from './sync'

enablePatches()

const setEvent = (key: string) => '_SET:' + key
const getEvent = (key: string) => '_GET:' + key
const patchEvent = (key: string) => '_PATCH:' + key
const actionEvent = (key: string) => '_ACTION:' + key
const taskStartEvent = (key: string) => '_TASK_START:' + key
const taskCancelEvent = (key: string) => '_TASK_CANCEL:' + key

function extractData<S extends Record<string, any>>(initialState: S, state: any): S {
  const data: any = {}
  Object.keys(initialState).forEach(k => { data[k] = state[k] })
  return data as S
}

export function createSyncedReducerStore<S extends Record<string, any>>(
  key: string,
  reducer: SyncedReducer<S> | undefined,
  initialState: S,
  session: Session,
  sendOnInit = false
): [StoreApi<StateWithSync<S>>, (action: Action) => void] {
  const sendState = (state: S) => session.send(setEvent(key), state)
  const sendPatch = (patch: any) => session.send(patchEvent(key), patch)
  const sendAction = (action: Action) => session.send(actionEvent(key), action)
  const startTask = (task: TaskStart) => session.send(taskStartEvent(key), task)
  const cancelTask = (task: TaskCancel) => session.send(taskCancelEvent(key), task)
  const sendBinary = (action: Action, data: ArrayBuffer) =>
    session.sendBinary(actionEvent(key), action, data)
  const fetchRemoteState = () => session.send(getEvent(key), {})

  const store = createStore<StateWithSync<S>>((set, get) => {

    const setters: Record<string, any> = {}
    Object.keys(initialState).forEach(attr => {
      const upper = attr.charAt(0).toUpperCase() + attr.slice(1)
      setters[`set${upper}`] = (val: any) => set((state: any) => ({ ...state, [attr]: val }))
      setters[`sync${upper}`] = (val: any) => {
        set((state: any) => ({ ...state, [attr]: val }))
        sendPatch([{ op: 'replace', path: `/${attr}`, value: val }])
      }
    })

    return {
      ...initialState,
      ...setters,
      fetchRemoteState,
      sendAction,
      startTask,
      cancelTask,
      sendBinary,
    } as StateWithSync<S>
  })

  const setData = (data: S) => {
    store.setState(state => ({ ...state, ...data }))
  }
  const patchData = (patch: any) => {
    const current = extractData(initialState, store.getState())
    const newData = patch.reduce(applyReducer, deepClone(current))
    store.setState(state => ({ ...state, ...newData }))
  }

  const dispatch = (action: Action) => {
    if (!reducer) return
    const createEffect: any[] = []
    const sync = () => createEffect.push((patch: any[]) => () => {
      if (patch.length > 0) sendPatch(patch)
    })
    const delegate = (actionOverride?: Action) => createEffect.push((patch: any[]) => () => {
      sendAction(actionOverride ?? action)
    })

    const withPatch = produceWithPatches(reducer)
    const [newState, patch] = withPatch(castImmutable(extractData(initialState, store.getState())), action, sync, delegate)
    setData(newState)
    createEffect.forEach(f => f(patch)())
  }

  session.registerEvent(getEvent(key), () => {
    const data = extractData(initialState, store.getState())
    sendState(data)
  })
  session.registerEvent(setEvent(key), setData)
  session.registerEvent(patchEvent(key), patchData)
  session.registerEvent(actionEvent(key), dispatch)
  if (sendOnInit) session.registerInit(key, () => sendState(extractData(initialState, store.getState())))

  return [store, dispatch]
}

export function createSyncedStore<S extends Record<string, any>>(
  key: string,
  initialState: S,
  session: Session,
  sendOnInit = false
): StoreApi<StateWithSync<S>> {
  const [store] = createSyncedReducerStore(key, undefined, initialState, session, sendOnInit)
  return store
}
