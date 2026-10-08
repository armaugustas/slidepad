<p align="center"><img src="docs/icon.svg" width="72" alt=""></p>

<h1 align="center">slidepad</h1>

<p align="center"><b>Your phone is the clicker.</b><br>
A trackpad and slide remote for any computer — no app, no login, no server.</p>

<p align="center"><a href="https://armaugustas.github.io/slidepad/"><b>armaugustas.github.io/slidepad</b></a></p>

---

## How it works

1. **Open the site on the computer.** It shows a QR code and a 6-digit code.
2. **Scan the QR with your phone’s camera.** The phone becomes a trackpad with big Next / Prev buttons.

That’s it. Phones are detected automatically — open the same link on a phone and you get the remote.

### Two modes

| | **Present here** | **Control this computer** |
|---|---|---|
| What it drives | Slides inside the browser tab (drop in any PDF) | The real keyboard and mouse — Keynote, PowerPoint, Google Slides, anything |
| Setup on the computer | Nothing | Paste one line into Terminal / PowerShell |
| Pointer | Glowing laser dot | Moves the real cursor |

For **Control this computer**, the page asks you to paste one line:

```sh
# macOS — Terminal
curl -fsSL https://armaugustas.github.io/slidepad/mac.sh | sh
```

```powershell
# Windows — PowerShell
irm https://armaugustas.github.io/slidepad/win.ps1 | iex
```

Nothing is installed. The Mac helper runs from a temporary folder that’s deleted when you press <kbd>Ctrl</kbd>+<kbd>C</kbd> or close the window; the Windows helper is a script that lives only in that PowerShell session. Neither starts at login. On macOS you’ll be asked once to allow **Terminal** under *System Settings → Privacy & Security → Accessibility* — that’s what lets it press keys.

## Gestures

| On the phone | In the browser deck | With the helper |
|---|---|---|
| Drag on the pad | Moves the laser dot | Moves the mouse |
| Tap | Clicks — on a slide that means next | Left click |
| Flick ← / → | Next / previous | <kbd>→</kbd> / <kbd>←</kbd> |
| Next / Prev buttons | Next / previous | <kbd>→</kbd> / <kbd>←</kbd> |
| Blank button | Black screen | <kbd>B</kbd> (black screen in Keynote & PowerPoint) |

Pointer speed is accelerated: slow strokes are precise, quick ones cross the screen. On the computer, <kbd>←</kbd> <kbd>→</kbd> <kbd>Space</kbd> <kbd>F</kbd> (fullscreen) <kbd>O</kbd> (open PDF) and <kbd>B</kbd> also work, as do most USB clickers.

## Architecture

```
 phone (browser)  ◄──── WebRTC data channel, peer-to-peer ────►  computer (browser tab)
        │                                                            │
        └──── one-time handshake via the public PeerJS broker ───────┘
                                                                     │ fetch → http://127.0.0.1:7421
                                                                     ▼
                                                    optional local helper (real keys + mouse)
```

- **Static site on GitHub Pages.** Everything is in [`docs/`](docs). No backend of our own.
- **Peer-to-peer.** The phone and computer connect directly over WebRTC (with STUN, and PeerJS’s public TURN relay as a fallback on strict networks). The [PeerJS](https://peerjs.com) broker is only used to introduce them; your input never goes through it.
- **Pairing.** The 6-digit code is the room. The QR code also carries a 96-bit secret, so a scanned phone is trusted instantly. A phone that *types* the code must be approved with an **Allow** prompt on the computer — because in helper mode, a phone can press keys on your machine.
- **The helper** listens on `127.0.0.1` only, accepts commands only from the Slidepad origin (and `localhost` for development), rejects DNS-rebinding `Host` headers, and only understands a fixed vocabulary: slide keys, pointer move, click. It can’t type text.

## Development

```sh
npm install        # PeerJS, pdf.js, qrcode-generator (vendored into docs/vendor)
npm run vendor     # re-copy the browser builds into docs/vendor
npm run dev        # serves docs/ on :5173 and prints a Wi-Fi URL your phone can open
./helper/mac/build.sh   # rebuilds the universal macOS helper into docs/helper/
```

Open the **Wi-Fi URL** printed by `npm run dev` on the computer (not `localhost`) so the QR code points somewhere your phone can reach.

| Path | What |
|---|---|
| `docs/screen.js` | Computer side: session, QR, approval, deck, laser, helper bridge UI |
| `docs/remote.js` | Phone side: join, trackpad gestures, reconnect, wake lock |
| `docs/deck.js` | Demo deck + PDF rendering (pdf.js) with neighbour prefetch |
| `docs/helper.js` | Talks to the local helper; coalesces pointer moves |
| `helper/mac/main.swift` | macOS helper (CGEvent), built universal |
| `docs/win.ps1` | Windows helper (PowerShell + user32) |

## License

MIT
