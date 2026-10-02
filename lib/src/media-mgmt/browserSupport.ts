/**
 * Whether this browser can share a screen. Most mobile browsers, including
 * iOS Safari, have no `getDisplayMedia`.
 */
export function browserSupportsScreenShare(): boolean {
  return typeof navigator?.mediaDevices?.getDisplayMedia === "function";
}
