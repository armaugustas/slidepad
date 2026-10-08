<p align="center"><img src="docs/icon.svg" width="72" alt=""></p>

<h1 align="center">slidepad</h1>

<p align="center"><b>Your phone is the clicker.</b><br>
Slides, speaker notes and a laser pointer on every phone in the room — no app, no login, no server.</p>

<p align="center"><a href="https://armaugustas.github.io/slidepad/"><b>armaugustas.github.io/slidepad</b></a></p>

---

## How it works

1. **Open the site on the computer** that’s connected to the screen. Add your presentations (PDF).
2. **Scan the QR code with your phone’s camera.** That’s it — the first phone in becomes the **Admin**.
3. Anyone else who scans joins too. Press <kbd>J</kbd> while presenting to put the join code on screen.

Phones are detected automatically: open the same link on a phone and you get the remote.

## On the phone

- **Live slide preview** — the current slide, plus the next one if you can drive.
- **Speaker notes** — follow the slides live, with adjustable text size.
- **Back / Next** — big thumb-sized buttons. Flicking the slide preview left or right works too.
- **Laser** — drag on the pad to steer a glowing dot on the big screen. Slow is precise, fast crosses the screen. Tap for the next slide.

## Roles

| | Sees slides & notes | Changes slides | Laser | Switches presentations, manages people & settings |
|---|---|---|---|---|
| **Admin** | ✓ | ✓ | ✓ | ✓ |
| **Teammate** | ✓ | ✓ | if allowed | |
| **Member** | ✓ | | | |

Change anyone’s role from the computer’s **People** panel or from an admin’s phone menu. Settings: what role new people get, whether teammates can use the laser, and **Lock the room** so no one new can join.

Scanning the QR code lets you straight in. Typing the 6-digit code instead needs a yes — from the computer or any admin’s phone.

## Presentations & notes

- Drop **PDFs** anywhere on the page. They’re remembered in this browser (IndexedDB), so a refresh keeps your library.
- **Speaker notes** come from a matching **.pptx** — drop it with the PDF (same file name) or use *Add notes* on a card. Hidden slides are skipped so notes line up with the PDF export.
- Or a **.txt** / **.md** with `---` between slides.
- Keynote: *File → Export To → PDF* for the slides, and *→ PowerPoint* for the notes.

Keyboard while presenting: <kbd>←</kbd> <kbd>→</kbd> <kbd>Space</kbd>, <kbd>F</kbd> fullscreen, <kbd>J</kbd> join code, <kbd>H</kbd> / <kbd>Esc</kbd> home. Most USB clickers work too.

## Architecture

```
 phones (browser)  ◄──── WebRTC data channels, peer-to-peer ────►  computer (browser tab = the host)
         │                                                                │
         └──────── one-time handshake via the public PeerJS broker ───────┘
```

- **Static site on GitHub Pages** — everything is in [`docs/`](docs). No backend of our own.
- **Peer-to-peer.** Phones connect directly to the computer over WebRTC (STUN, with PeerJS’s public TURN relay as a fallback on strict networks). The [PeerJS](https://peerjs.com) broker only introduces them.
- **The computer is the source of truth**: it holds the library, the room (people, roles, settings) and enforces permissions on every message. Each phone gets a stable anonymous ID, so roles survive reconnects and refreshes.
- **Pairing.** The 6-digit code is the room; the QR also carries a 96-bit secret. Approved phones receive the secret so they can reconnect without asking again.

| Path | What |
|---|---|
| `docs/screen.js` | Computer: library, room & roles, presenting, laser |
| `docs/remote.js` | Phone: join, preview, notes, nav, laser pad, admin menu |
| `docs/deck.js` | Demo deck (canvas) + PDF rendering (pdf.js) with prefetch and thumbnails |
| `docs/notes.js` | Speaker notes from .pptx (JSZip) or text |
| `docs/library.js` | IndexedDB persistence for added presentations |

## Development

```sh
npm install      # PeerJS, pdf.js, JSZip, qrcode-generator
npm run vendor   # copy their browser builds into docs/vendor
npm run dev      # serves docs/ on :5173 and prints a Wi-Fi URL your phone can open
```

Open the **Wi-Fi URL** on the computer (not `localhost`) so the QR code points somewhere your phone can reach.

## Credits

Logo and interface icons: [Lucide](https://lucide.dev) (ISC License). PDF rendering: [pdf.js](https://mozilla.github.io/pdf.js/). Peer-to-peer: [PeerJS](https://peerjs.com). Notes: [JSZip](https://stuk.github.io/jszip/). QR: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator).

## License

MIT
