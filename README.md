# Stickbeats: EdgeTX voice packs and sound themes

**Voice packs** in 16 languages, previewable phrase by phrase, plus free CC0 voices made for this project: Dutch (Flemish and standard), British, Australian and Scottish English. The voices live in the [edgetx-sdcard-sounds fork](https://github.com/HansF/edgetx-sdcard-sounds); `voices_build.py` turns that repo into the site's catalogue, previews, hosted zips and one crawlable page per voice (`site/v/<id>.html`). Most official EdgeTX voices are hosted here too (so the mixer can bundle them), except GLaDOS and Joshua Bardwell's recording, which stay linked to the EdgeTX release. Voice packs are stored as 16 kHz FLAC (`site/dl/voice-<id>.flac.zip`) and converted to WAV in the browser by `site/assets/voicepack.js`, which keeps the site under GitHub Pages' 1 GB limit. In CI the voice repo is fetched as a sparse partial clone (`voices_build.py --sparse-patterns`); locally, set `EDGETX_VOICES_SRC` or keep the fork next to this checkout.

**Sound themes:** 47 free sound themes for EdgeTX radios. Each one replaces the radio's beeps, warnings and callouts (boot, arm/disarm, low battery, telemetry lost, RF critical, timers, trims, flight modes…) with sounds composed for that theme.

**Site:** https://over9kfpv.github.io/stickbeats/ lets you listen to every sound, compare themes, build your own mix and download ready-to-copy SD card packs.

| Category | Themes |
| --- | --- |
| Retro consoles | 8-Bit Hero, Block Drop, Pocket DMG, Blast Processing, 16-Bit Quest, Arcade '82 |
| Old PCs & phones | PC Speaker, AdLib FM, Dial-Up '98, Polyphonic 2003 |
| Screen & story | Wizard Academy, Chopper Command '84, Starship Bridge, Imperial Fleet, Neon Grid, Signal from Beyond, Haunted Manor, Medieval Bard |
| Sim & tycoon | Life Sim, Theme Park '99, City Planner 2000 |
| Game homages | Stealth Op, Meadow Hero, Ring Dash, Warp Pipe, Hellmetal, War Room, Safe Room, Agent 64, Hazard Suit, Bounty Hunter, Shmup Fury, Dojo Duel, Polygon Brawler, Tournament Gong, Rally Stage, Jungle Rumble, Nocturne Keep |
| Gen Z, Gen Alpha & weird | Brainrot, Drift Phonk, Hyperpop, Kazoo Orchestra, Cat Mode, Rubber Duck Squad, NPC Mode, Elevator Bossa, Lo-fi Study |

All music is original, except public-domain tunes (Korobeiniki, Tárrega's Gran Vals). The themes are in the spirit of their eras; they are not affiliated with any game, film or TV show.

## Install a pack

Unzip it and copy its `SOUNDS` folder onto the root of the radio's SD card. Only the 70 event files are replaced; spoken numbers and units stay. See [install](https://over9kfpv.github.io/stickbeats/install.html).

## Record your own sounds

The home page has a dedicated **Record your own** section (`#record`) that explains the flow and links to the Mix page.

The **Mix** page can record a personal replacement for each of the 70 sound events. Click
**Record**, allow microphone access, and stop when finished. Smart trim suggests the sound's
start and end while preserving pauses. Adjust the waveform selection, preview it, then choose
**Use recording**. The original take stays available through **Edit**.

Recording stops at 30 seconds; saved selections can be up to 10 seconds. The editor shows the
shorter recommended duration for each event. ZIP exports convert recordings to 16 kHz mono
16-bit WAV and combine them with your theme selections and optional voice pack.

Recording needs HTTPS or localhost. Audio never leaves your device: IndexedDB stores the
recordings and localStorage remembers project settings. The page restores your local project
on your next visit. Download a ZIP as a backup; clearing site data removes saved recordings.
Shared links contain theme selections only, with an explicit option to resume your local
project or save the shared mix locally. The exported ZIP is an SD card pack, not an editable
project backup.

JavaScript tests (Node 20+):

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
# Optional browser checks after installing the corresponding Playwright browser:
BROWSER=firefox npm run test:browser
BROWSER=webkit npm run test:browser
```

Browser tests use an isolated local server, fixture packs and synthetic microphone audio;
no real microphone or generated sound catalogue is needed.

## How it works

Every sound is a `Score` (`soundgen/score.py`): tracks of notes with bends, vibrato and drum hits. It is written out as a real MIDI file (shipped in each theme's MIDI zip) and rendered by `soundgen/render.py`:

- `chip:*`: NES/Game Boy pulse, triangle, wave and noise channels, and a 1-bit PC speaker
- `syn:*`: supersaws, synth brass, reese bass, theremin, Karplus-Strong strings, organ, calliope…
- `fm:*`: 2- and 3-operator FM (e-piano, bells, marimba, OPL/YM-style patches)
- `kit:*`: 808 / 909 / chip / phonk drum machines
- `fx:*`: procedural effects (vine boom, air horn, modem handshake, meows, rubber ducks, coaster screams…)
- `gm:<program>`: General MIDI instruments via FluidSynth and the GeneralUser GS soundfont

`soundgen/roles.py` maps each EdgeTX file to a role (`arm`, `lowbat`, `signal_crit`, …). `soundgen/theme.py` gives every role a template default, and each theme in `soundgen/themes/` overrides the roles that define it.

Output is 16 kHz, mono, 16-bit WAV, loudness-matched (-15 dBFS RMS, -1 dBFS peak).

## Build

Needs Python 3.11+, [uv](https://docs.astral.sh/uv/), `ffmpeg`, `fluidsynth` and the [GeneralUser GS](https://schristiancollins.com/generaluser.php) soundfont at `~/.cache/edgetx-sound-themes/GeneralUser-GS.sf2` (or set `EDGETX_SF2`).

```sh
uv run pytest -q                 # every theme must pass the safety checks
uv run build.py                  # all packs -> out/<theme>/SOUNDS/en + out/<theme>/midi
uv run build.py cat-mode         # one theme
uv run build.py --site           # + site/data, previews, zips, voice catalogue; then serve site/
uv run build.py --private        # + personal themes from private_themes/ (gitignored) -> private/
uv run build.py --private --masters ~/my-sounds   # ...with your own WAVs layered on top
```

`private_themes/` is for packs you keep to yourself, such as recreations of copyrighted game sounds. It is gitignored, never built by CI and never published.

Pushing to `main` runs the tests, builds everything and deploys `site/` to GitHub Pages (`.github/workflows/pages.yml`).

## Adding a theme

Create `soundgen/themes/<file>.py` with a `Theme` subclass: set `id`, `name`, `category`, `tagline`, `blurb`, `skin` and a palette, then write at least `startup`, `arm`, `disarm`, `yes`, `no`, `lowbat`, `critbat`, `found` and `lost`. It's registered automatically. The tests enforce:

- all 70 files, valid format, loudness in range
- alerts at most 1.2 s, everything at most 2 s
- arm differs from disarm, on differs from off
- critical alerts have at least 3 separate bursts

## License

Original theme sounds, MIDI and voices made by Stickbeats: CC0. Code: MIT. Third-party EdgeTX voices retain their original licenses. See [LICENSE](LICENSE).
