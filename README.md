# Roadster: Thrust Lab

A browser-based Three.js stunt-driving demo with keyboard and touch controls, wall grip, a curved wall ride, a circular wall-grip tunnel, brake-to-drift handling, telemetry, camera orbit, and reactive audio.

## Project structure

```text
thrust-lab-project/
├── index.html             # UI markup
├── styles.css             # Responsive HUD, intro screen, touch controls, and visual styling
├── script.js              # Scene setup, vehicle geometry, physics, controls, camera, particles, and audio
└── assets/
    └── audio/
        └── README.md      # Pixabay source links and expected local filenames
```

## Run it locally

Three.js is loaded from jsDelivr, so the browser needs an internet connection for that library. For predictable relative audio paths, serve the project over HTTP instead of opening `index.html` directly.

With Python installed, open a terminal in this folder and run:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Where to tune things

The JavaScript is grouped with section comments. Search `script.js` for these names:

- `wallRideConfig` — wall-ride height, width, crest and throw angle.
- `TUNNEL` — tunnel dimensions and placement.
- `VEHICLE_MASS`, `VEHICLE_INERTIA`, `WHEEL_CONTACT_OFFSETS`, `CHASSIS_CONTACT_OFFSETS` — vehicle mass and physical contact layout.
- `updatePhysics()` — suspension, wheel traction, natural brake-to-drift handling, wall grip, thruster response, and landing assist.
- `SCENARIOS` — starting position and velocity for each scenario.
- `PIXABAY_AUDIO_PATHS` — optional local MP3 asset locations.
- `MOUSE_RETURN_DELAY` and `MOUSE_RETURN_DURATION` — camera look-return behavior.

Some short vector names remain inside physics calculations because they are local mathematical values, but scene-level names and the main systems now use descriptive identifiers.

## Audio behavior

The current synthesized Web Audio engine, thruster, tire and landing sounds continue to work by default. `script.js` also supports local Pixabay MP3s at the paths in `PIXABAY_AUDIO_PATHS`; when a file is available, it uses that sample, and otherwise the synthesized sound is used as a fallback. See `assets/audio/README.md` for source pages and filenames.

**Pixabay MP3 files are not bundled in this ZIP.** I could access the Pixabay sound pages and verify their listings, but the downloadable media binaries could not be fetched from this runtime. The expected filenames are already wired into the code; download the files from the linked pages and place them in `assets/audio/` to enable them.

## Notes

- The Roadster is a fan project and is not affiliated with or endorsed by Tesla.
- Existing gameplay settings and scenario positions were carried over from the latest supplied HTML. The responsive mobile HUD gap was reduced by moving the mobile status card closer to the compact scenario selector.
