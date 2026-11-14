import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import { gameRef } from './ui/gameRef';
import { B } from './game/registry/blocks';
import { itemByKey } from './game/registry/items';
// handle used by the automated browser tests (and handy from the dev console)
Object.assign(window, { __deepwild: gameRef, __deepwildReg: { B, item: (k: string) => itemByKey(k).id } });

function webglOK() {
  try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; }
}
const root = createRoot(document.getElementById('root')!);
if (!webglOK()) {
  root.render(<div className="screen"><div className="panel" style={{ maxWidth: 520 }}><h2 className="h">WebGL 2 is required</h2><p>Deepwild needs a desktop browser with WebGL 2 (current Chrome, Edge or Firefox). Check that hardware acceleration is turned on.</p></div></div>);
} else {
  root.render(<App />);
}
