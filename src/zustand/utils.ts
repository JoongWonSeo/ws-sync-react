type Empty = Record<string, never>;

/**
 * Utility type that creates action functions from a mapping of action names to parameter types.
 *
 * @template NameToKey - Maps action names to parameter type keys
 * @template KeyToParams - Maps parameter type keys to their actual parameter types
 *
 * @example
 * ```typescript
 *
 * type ActionsKeys = {
 *   select: 'SELECT_NOTE';
 *   clear: 'CLEAR_SELECTION';
 * };
 * type ActionsParams = {
 *   SELECT_NOTE: { id: string };
 *   CLEAR_SELECTION: null;
 * };
 *
 * type MyActions = Actions<ActionsKeys, ActionsParams>;
 * // Result: {
 * //   select: (args: { id: string }) => void;
 * //   clear: () => void;
 * // }
 * ```
 */
export type Actions<
  NameToKey extends { [N in keyof NameToKey]: keyof KeyToParams },
  KeyToParams
> = {
  [N in keyof NameToKey]: KeyToParams[NameToKey[N]] extends null
    ? (empty?: Empty) => void // accepts no args or empty object only
    : (args: KeyToParams[NameToKey[N]]) => void;
};

/**
 * Utility type that creates task control objects with start/cancel methods.
 *
 * @template NameToKey - Maps task names to parameter type keys
 * @template KeyToParams - Maps parameter type keys to their actual parameter types
 *
 * @example
 * ```typescript
 * type TasksKeys = {
 *   export: 'EXPORT_DATA';
 *   import: 'IMPORT_DATA';
 * };
 * type TasksParams = {
 *   EXPORT_DATA: { format: string };
 *   IMPORT_DATA: { file: string };
 * };
 *
 * type MyTasks = Tasks<TasksKeys, TasksParams>;
 * // Result: {
 * //   export: {
 * //     start: (args: { format: string }) => void;
 * //     cancel: () => void;
 * //   };
 * //   import: {
 * //     start: (args: { file: string }) => void;
 * //     cancel: () => void;
 * //   };
 * // }
 * ```
 */
export type Tasks<
  NameToKey extends { [N in keyof NameToKey]: keyof KeyToParams },
  KeyToParams
> = {
  [N in keyof NameToKey]: {
    start: KeyToParams[NameToKey[N]] extends null
      ? (empty?: Empty) => void // accepts no args or empty object only
      : (args: KeyToParams[NameToKey[N]]) => void;
    cancel: () => void;
  };
};
