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

- **The slide** — a live preview of what’s on the big screen. **Touch it to point**: a laser dot appears in the same spot up there.
- **Notes** — the speaker notes for this slide, with adjustable text size.
- **Back / Next** — two big buttons at the bottom.

## Roles

| | Sees slides & notes | Changes slides & points | Switches presentations, manages people |
|---|---|---|---|
| **Admin** | ✓ | ✓ | ✓ |
| **Teammate** | ✓ | ✓ | |
| **Member** | ✓ | | |

Change anyone’s role from the computer’s **People** panel or from an admin’s phone menu. Two room settings (behind the gear): whether new people can drive, and **Lock the room** so no one new can join.

Scanning the QR code lets you straight in. Typing the 6-digit code instead needs a yes — from the computer or any admin’s phone.

## Presentations & notes

- Drop **PDFs** anywhere on the page. They’re remembered in this browser (IndexedDB), so a refresh keeps your library.
- **Speaker notes** come from a matching **.pptx** — drop it with the PDF (same file name) or use *Add notes* on a card. Hidden slides are skipped so notes line up with the PDF export.
- Or a **.txt** / **.md** with `---` between slides.
- Keynote: *File → Export To → PDF* for the slides, and *→ PowerPoint* for the notes.

Keyboard while presenting: <kbd>←</kbd> <kbd>→</kbd> <kbd>Space</kbd>, <kbd>F</kbd> fullscreen, <kbd>J</kbd> join code, <kbd>H</kbd> / <kbd>Esc</kbd> home. Most USB clickers work too.

## Architecture

```
 phones (browser)  ──┐                                   ┌──  computer (browser tab = the host)
                     └──►  public MQTT brokers (wss)  ◄──┘
                            HiveMQ · shiftr.io (443) · Mosquitto
```

- **Static site on GitHub Pages** — everything is in [`docs/`](docs). No backend of our own.
- **Relay, not peer-to-peer.** Phones and the computer talk through free public MQTT brokers over secure WebSockets, which get through mobile data and locked-down Wi-Fi. (Direct WebRTC needs a TURN relay on those networks, and every free TURN server tested was dead.) Both sides connect to three brokers at once and publish on all of them; receivers drop duplicates by sequence number, so one broker going down changes nothing.
- **End-to-end encrypted.** The brokers only ever see ciphertext and random topic names:
  - the QR secret derives the room topic and an AES-GCM room key (slides, notes, join requests);
  - every phone gets its own ECDH P-256 key with the computer, so nobody else in the room can read or forge its messages (an admin’s role changes can’t be spoofed by a member);
  - a phone that *types* the code knocks on a lobby with its public key; once approved, it receives the room secret encrypted to that key.
- **The computer is the source of truth**: library, people, roles and settings live there, and it checks permissions on every message. Heartbeats every 4 s detect phones and screens that disappear; a refreshed screen announces a new epoch and phones rejoin automatically, keeping their roles.

| Path | What |
|---|---|
| `docs/screen.js` | Computer: library, room & roles, presenting, laser |
| `docs/remote.js` | Phone: join, preview, notes, nav, touch-to-point, admin menu |
| `docs/transport.js` | Encrypted relay over public MQTT brokers (host + guest) |
| `docs/deck.js` | Demo deck (canvas) + PDF rendering (pdf.js) with prefetch and thumbnails |
| `docs/notes.js` | Speaker notes from .pptx (JSZip) or text |
| `docs/library.js` | IndexedDB persistence for added presentations |

## Development

```sh
npm install      # MQTT.js, pdf.js, JSZip, qrcode-generator, Geist
npm run vendor   # copy their browser builds into docs/vendor
npm run dev      # serves docs/ on :5173 and prints a Wi-Fi URL your phone can open
```

Encryption uses WebCrypto, which browsers only allow on `https://` or `localhost`. To try it with a real phone, use the published site (or an https tunnel); a plain `http://192.168…` Wi-Fi address won’t connect.

## Design

Bound to the Kaching house system from the Larpo engine — see [DESIGN.md](DESIGN.md).

## Credits

Type: [Geist](https://vercel.com/font) (OFL). Logo and interface icons: [Lucide](https://lucide.dev) (ISC License). PDF rendering: [pdf.js](https://mozilla.github.io/pdf.js/). Relay: [MQTT.js](https://github.com/mqttjs/MQTT.js) and the public HiveMQ, shiftr.io and Eclipse Mosquitto brokers. Notes: [JSZip](https://stuk.github.io/jszip/). QR: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator).

## License

MIT
