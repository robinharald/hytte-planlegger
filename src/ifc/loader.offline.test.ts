/**
 * The IFC reader offline before its first use (ifc/loader.ts, store.ts): when web-ifc cannot be downloaded the load
 * fails with the reason 'offline' and the panel says that the first time needs the network (not that the file is
 * unreadable); a failed loader chunk says the same; other failures keep their texts.
 */
import { describe, expect, it, vi } from 'vitest';
import { nb } from '../i18n/nb';
import { IfcLoadError, loadIfcFile } from './loader';
import { errorText } from './store';

// web-ifc's engine fetches its wasm when it starts: offline before the first use that fetch fails
vi.mock('web-ifc', () => ({
  IfcAPI: class {
    Init(): Promise<void> {
      return Promise.reject(new Error('Aborted(both async and sync fetching of the wasm failed)'));
    }
  },
}));

const ifcBytes = new TextEncoder().encode('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
const file = { name: 'hytta.ifc', size: ifcBytes.byteLength, arrayBuffer: async () => ifcBytes.buffer.slice(0) as ArrayBuffer };

describe('IFC first use offline', () => {
  it("the engine cannot be downloaded: reason 'offline', and the panel says the first time needs the network", async () => {
    const e = await loadIfcFile(file).then(
      () => null,
      (err: unknown) => err,
    );
    expect(e).toBeInstanceOf(IfcLoadError);
    expect((e as IfcLoadError).reason).toBe('offline');
    expect(errorText(e)).toBe(nb.export.offlineFirstUse);
  });

  it('maps the other failures', () => {
    expect(errorText(new IfcLoadError('failed'))).toBe(nb.ifc.failed);
    expect(errorText(new IfcLoadError('not-ifc'))).toBe(nb.ifc.notIfc);
    expect(errorText(new IfcLoadError('empty'))).toBe(nb.ifc.empty);
    // the loader chunk itself was never downloaded
    expect(errorText(new TypeError('Failed to fetch dynamically imported module: http://x/assets/loader-1.js'))).toBe(nb.export.offlineFirstUse);
    expect(errorText(new TypeError('Importing a module script failed.'))).toBe(nb.export.offlineFirstUse);
    expect(errorText(new Error('boom'))).toBe(nb.ifc.failed);
  });
});
