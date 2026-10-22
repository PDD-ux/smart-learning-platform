/** Next16 supplies thenables; plain objects remain useful in direct component tests. */
export function isRoutePromise<T extends object>(value: T | Promise<T> | undefined): value is Promise<T> {
  return value !== null && typeof value === 'object' && 'then' in value && typeof value.then === 'function';
}
