# Optional Pixabay audio files

The game remains playable without these files: `script.js` synthesizes reactive engine, thruster, tire-skid, and landing sounds with Web Audio when local samples are absent.

To use the Pixabay samples, download the free MP3 files from their source pages and save them with these exact filenames in this folder:

| Filename expected by `script.js` | Purpose | Pixabay source |
| --- | --- | --- |
| `thruster-loop.mp3` | Looping rocket / sci-fi thruster sound | <https://pixabay.com/sound-effects/technology-thruster-loop-562715/> |
| `jet-engine-acceleration.mp3` | Engine startup / acceleration cue | <https://pixabay.com/sound-effects/film-special-effects-jet-engine-start-up-and-acceleration-sound-effect-328919/> |
| `rocket-landing.mp3` | Landing impact cue | <https://pixabay.com/sound-effects/technology-rocket-landing-38715/> |

The referenced Pixabay pages identify these clips as MP3 sound effects available for use under the Pixabay Content License. Check the current license and attribution details on each source page before distributing your own build.

Example final paths:

```text
assets/audio/thruster-loop.mp3
assets/audio/jet-engine-acceleration.mp3
assets/audio/rocket-landing.mp3
```

This folder intentionally does not contain placeholder MP3s: the actual source binaries were not accessible for download in the build environment.
