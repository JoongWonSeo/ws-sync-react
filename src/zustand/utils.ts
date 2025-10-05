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
    ? () => void //TODO: this is a lie, it's actually an optional empty arg that defaults to {} and must be {}
    : (args: KeyToParams[NameToKey[N]]) => void;
};
