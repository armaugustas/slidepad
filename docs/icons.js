// Icons from Lucide (https://lucide.dev) — ISC License, Copyright (c) Lucide Contributors.
const PATHS = {
  "presentation": "<path d=\"M2 3h20\" /><path d=\"M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3\" /><path d=\"m7 21 5-5 5 5\" />",
  "chevron-left": "<path d=\"m15 18-6-6 6-6\" />",
  "chevron-right": "<path d=\"m9 18 6-6-6-6\" />",
  "menu": "<line x1=\"4\" x2=\"20\" y1=\"12\" y2=\"12\" /><line x1=\"4\" x2=\"20\" y1=\"6\" y2=\"6\" /><line x1=\"4\" x2=\"20\" y1=\"18\" y2=\"18\" />",
  "x": "<path d=\"M18 6 6 18\" /><path d=\"m6 6 12 12\" />",
  "plus": "<path d=\"M5 12h14\" /><path d=\"M12 5v14\" />",
  "play": "<polygon points=\"6 3 20 12 6 21 6 3\" />",
  "house": "<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\" /><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\" />",
  "maximize": "<path d=\"M8 3H5a2 2 0 0 0-2 2v3\" /><path d=\"M21 8V5a2 2 0 0 0-2-2h-3\" /><path d=\"M3 16v3a2 2 0 0 0 2 2h3\" /><path d=\"M16 21h3a2 2 0 0 0 2-2v-3\" />",
  "qr-code": "<rect width=\"5\" height=\"5\" x=\"3\" y=\"3\" rx=\"1\" /><rect width=\"5\" height=\"5\" x=\"16\" y=\"3\" rx=\"1\" /><rect width=\"5\" height=\"5\" x=\"3\" y=\"16\" rx=\"1\" /><path d=\"M21 16h-3a2 2 0 0 0-2 2v3\" /><path d=\"M21 21v.01\" /><path d=\"M12 7v3a2 2 0 0 1-2 2H7\" /><path d=\"M3 12h.01\" /><path d=\"M12 3h.01\" /><path d=\"M12 16v.01\" /><path d=\"M16 12h1\" /><path d=\"M21 12v.01\" /><path d=\"M12 21v-1\" />",
  "trash-2": "<path d=\"M3 6h18\" /><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\" /><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\" /><line x1=\"10\" x2=\"10\" y1=\"11\" y2=\"17\" /><line x1=\"14\" x2=\"14\" y1=\"11\" y2=\"17\" />",
  "sticky-note": "<path d=\"M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z\" /><path d=\"M15 3v4a2 2 0 0 0 2 2h4\" />",
  "users": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" /><circle cx=\"9\" cy=\"7\" r=\"4\" /><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\" /><path d=\"M16 3.13a4 4 0 0 1 0 7.75\" />",
  "settings": "<path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\" /><circle cx=\"12\" cy=\"12\" r=\"3\" />",
  "lock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /><path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />",
  "lock-open": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /><path d=\"M7 11V7a5 5 0 0 1 9.9-1\" />",
  "file-text": "<path d=\"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z\" /><path d=\"M14 2v4a2 2 0 0 0 2 2h4\" /><path d=\"M10 9H8\" /><path d=\"M16 13H8\" /><path d=\"M16 17H8\" />",
  "mouse-pointer-2": "<path d=\"M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z\" />",
  "log-out": "<path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\" /><polyline points=\"16 17 21 12 16 7\" /><line x1=\"21\" x2=\"9\" y1=\"12\" y2=\"12\" />",
  "check": "<path d=\"M20 6 9 17l-5-5\" />",
  "minus": "<path d=\"M5 12h14\" />",
  "type": "<polyline points=\"4 7 4 4 20 4 20 7\" /><line x1=\"9\" x2=\"15\" y1=\"20\" y2=\"20\" /><line x1=\"12\" x2=\"12\" y1=\"4\" y2=\"20\" />",
};

export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
