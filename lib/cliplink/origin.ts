/**
 * Where this tab's room API lives.
 *
 * A function, not a string: client modules are evaluated during server
 * rendering too, and a transport built at module scope would otherwise capture
 * an origin that does not exist yet.
 */
export function browserOrigin() {
  if (typeof window === "undefined") {
    throw new Error("The room API origin is only available in the browser.");
  }
  return window.location.origin;
}
