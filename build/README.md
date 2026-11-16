# build/

Sage's icon, the leaf on a green tile.

- `icon.svg`: the drawing (plain text; edit this one).
- `icon.png`: 512 by 512 picture made from the drawing. electron-builder reads it for `Sage.exe`, the
  installer and the shortcuts (`win.icon` in `electron-builder.json`), and `npm run build` copies it to
  `dist/icon.png` for the window.

After changing `icon.svg`, make `icon.png` again. Install the renderer in a folder **outside** the
repo (it is not a dependency of Sage), then run the render from the repo folder:

```text
mkdir ../icon-tools && cd ../icon-tools && npm init -y && npm install --ignore-scripts @resvg/resvg-js@2.6.2 && cd ../sage-assistant
node --input-type=module -e "import {Resvg} from '../icon-tools/node_modules/@resvg/resvg-js/index.js';import fs from 'node:fs';fs.writeFileSync('build/icon.png',new Resvg(fs.readFileSync('build/icon.svg'),{fitTo:{mode:'width',value:512}}).render().asPng())"
```

(The `mkdir` and `npm install` part is needed only once.) Commit both files; a test checks that
`icon.png` is 512 by 512.
