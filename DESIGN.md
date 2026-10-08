# Slidepad — design direction

Bound system: **Kaching** (Larpo shipped standard, `knowledge/larpo-shipped/kaching-DESIGN-SYSTEM.md`).
Geist / Geist Mono, `#f7f7f7` page, white cards on `#e3e3e3` hairlines, ink `#08090c` primary with `#303030`
hover and 0.98 press, 12–14px control radii, 16–24px preview radii, whisper depth
(`0 8px 20px -12px` at 12% ink), 1200px rail with 1px side rules. Dark mode mirrors Kaching's dark sections.

Owned decisions (on top of the system):
1. **Laser coral `#ff4d2e`** is the only accent — the laser, the live dot, the dither.
2. **Static ordered-dither field** rising from the bottom edge as the signature visual (rails stay on top).
3. **Point by touching the slide** — the phone's preview *is* the laser pad (absolute, not a trackpad).
4. Logo: Lucide `presentation` mark (no container) + 21px Geist wordmark, per founder logo rule.

Simplicity rules this product keeps:
- Desktop has one page (library + join + people) and one action (**Present**). Settings hide behind a gear.
- The phone shows three things: the slide, the notes, Back/Next. Admin tools live in the menu.
- Members never see controls they can't use.

Overrides:
- `type.body-size` (16px min): meta labels are 13–15px; this is dense app UI, not marketing copy.
- Founder hero Title Case: applied to the demo deck headlines and the join page h1; app section titles stay sentence case.

Checked with `tools/check.mjs` (Larpo engine): desktop 0 fail, phone join 0 fail.
