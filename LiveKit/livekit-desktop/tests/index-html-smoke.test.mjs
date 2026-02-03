import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('index.html smoke', () => {
  it('contains required UI elements', () => {
    const htmlPath = path.resolve(__dirname, '..', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const requiredIds = [
      'joinBtn',
      'startStreamBtn',
      'muteSystemBtn',
      'muteMicBtn',
      'connectionStatus',
      'chatDock',
      'chatLog',
      'streams',
      'participantsList'
    ];
    requiredIds.forEach((id) => {
      expect(doc.getElementById(id)).toBeTruthy();
    });
  });
});
