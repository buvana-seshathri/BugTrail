import { BINDING_NAME } from './probeProtocol';
import { installProbe } from './probe';

// Entry point bundled into `probe.js` and evaluated inside the inspected page.
// The binding is added with `Runtime.addBinding` before this runs.
const binding = (window as unknown as Record<string, unknown>)[BINDING_NAME];
if (typeof binding === 'function') {
  installProbe(window, (payload) => (binding as (s: string) => void)(JSON.stringify(payload)));
}
