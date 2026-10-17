# Roadster: Thrust Lab

**Roadster: Thrust Lab** is a browser-based, third-person stunt-driving playground inspired by the Tesla Roadster reveal and its rocket-assisted demonstration concept. It is built around experimentation rather than conventional racing: drive, build speed, launch, control the vehicle in the air, try unusual manoeuvres, and see whether you can land cleanly.

This is an independent fan project inspired by the idea and visual spectacle of a rocket-assisted Roadster. It is not an official Tesla product, is not endorsed by Tesla, and does not claim to reproduce Tesla's proprietary systems or undisclosed vehicle controls.

## Experience at a glance

The project is now a single open-world night-time test facility instead of five separate scenarios. Drive between zones, run the experiments, and chain stunts for combo multipliers.

- **Hand-authored Tesla Roadster model:** a GLB car (`tesla_roadster.glb`) with working headlamps and taillamps, replacing the earlier procedural body.
- **WebGPU rendering:** Three.js WebGPU renderer with a custom sky dome (sun, stars, clouds), distant mountains and a neon skyline, image-based lighting that matches the sky, and a post stack of bloom, speed-based chromatic blur, ACES tone mapping, vignette and film grain. Press `B` for a bloom tuning panel.
- **Rigid-body vehicle physics:** mass and inertia, per-wheel and chassis contact points, suspension, traction and brake-to-drift handling, solid-obstacle collision, and curved profile surfaces for walls steeper than the height-field allows.
- **Rocket-assisted stunts:** rear, bottom and side thrusters with a fuel reserve, airborne pitch/roll/yaw control, and AUTO landing assist or MANUAL direct control.
- **Wall adhesion:** toggle grip with `G` and hold `Shift` to ride walls and the circular tunnel.
- **Test zones:** Test Straight, Drop Tower, Adhesion Lab, Clearance Range, Kinematics Yard, Gravity Well, Collision Lab, Terrain Sim, Ascent Helix and Orbital Ramp.
- **Objectives and scoring:** light-gate checkpoints, collectible data orbs, hoops, boost pads, smashable crates and barrels, and a combo multiplier for flips, spins and adhesion runs.
- **Feedback:** thruster plume and landing dust particles (7,200-particle pool), a minimap, and telemetry for speed, fuel, G-force, altitude, airtime and jump distance.
- **Desktop and mobile:** keyboard and mouse orbit camera, a virtual joystick with touch thruster buttons, and a responsive HUD.
- **Generated audio:** engine, thruster, tire-slip and landing sounds are synthesized with the Web Audio API. No audio files are needed.

## Technology

- HTML and CSS for the interface and responsive layout
- JavaScript and Three.js (WebGPU build, with TSL post-processing) for rendering and scene geometry
- `GLTFLoader` for the Roadster model
- A custom rigid-body physics integrator for driving, contact, thruster forces and vehicle rotation
- Web Audio API for procedural sound effects

Three.js (v0.186.1) is loaded from jsDelivr through an import map, so an internet connection is required. A WebGPU-capable browser is recommended. There is no build step or package installation.

## Project structure

```text
thrust-lab-project/
├── index.html           # Page structure, import map, HUD, controls guide and creator links
├── styles.css           # Responsive layout, HUD, desktop UI and mobile touch controls
├── script.js            # Renderer, world zones, vehicle physics, objectives, camera, particles and audio
├── tesla_roadster.glb   # Roadster model
└── README.md            # Project overview and development notes
```

## Run locally

Serve the project over HTTP rather than opening `index.html` directly (the GLB and ES modules will not load from `file://`):

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

## Controls

### Desktop

| Input | Action |
| --- | --- |
| `W` / `S` | Throttle / brake; pitch while airborne |
| `A` / `D` | Steer; roll while airborne |
| `S` + `A`/`D` | Brake while turning to drift |
| `Space` | Rear rocket thruster |
| `F` | Bottom thrusters |
| `Q` / `E` | Yaw while airborne |
| `Z` / `C` | Side thrusters in MANUAL mode |
| `Shift` | Hold wall grip |
| `G` | Toggle the wall-grip system on or off |
| `M` | Switch AUTO / MANUAL thruster mode |
| Mouse drag | Orbit the camera; it returns to chase view after 3.5 seconds |
| `R` | Respawn at the last checkpoint |
| `T` | Return to the start |
| `B` | Show/hide the bloom panel |
| `H` | Hide/show the controls guide |
| `Esc` | Open/close the menu |

### Mobile

Use the on-screen joystick to accelerate/brake and steer. Pull back while steering to brake and drift. In the air, the joystick controls pitch and roll. Hold **ROCKET** for rear thrust and **LIFT** for bottom thrusters, and use **YAW** for rotation. **GRIP** toggles wall grip and **AUTO** switches landing-assist modes. Drag the scene to look around. Open **Controls** for the on-screen guide.

## Where to tune the experience

Search `script.js` for these names:

- `makeZone(...)` — each test zone's name, colour and bounds (for example `ZW` for the Adhesion Lab).
- `TUNNEL` — tunnel dimensions and world placement.
- `VEHICLE_MASS`, `VEHICLE_INERTIA`, `WHEEL_CONTACT_OFFSETS`, `CHASSIS_CONTACT_OFFSETS` — vehicle mass and contact layout.
- `SOLID_PROBES` — collision probe points around the car.
- `PARTICLE_COUNT` — thruster and dust particle pool size.
- `MOUSE_RETURN_DELAY` and `MOUSE_RETURN_DURATION` — camera look-return timing.
- `initSound()`, `updateSound()`, `playLandingImpact()` — synthesized audio.

## Visual and product direction

The goal is a premium, shareable vehicle playground: a compact stunt facility, distinctive ramps and targets, controlled airborne manoeuvres, convincing effects, cinematic but readable camera work, quick resets, and a responsive experience. Performance and clear feedback matter; visuals and effects should not obscure the driving surface or make the browser experience unstable.

The core idea is simple: **Drive it. Launch it. Rotate it. Try something ridiculous. See whether you can land it.**

## Credits and disclaimer

Created by [Muhammad Bilal Khan](https://x.com/Bk23544).

Inspired by the Tesla Roadster and the concept of rocket-assisted vehicle demonstrations. Tesla and Roadster are referenced for inspiration only. This is an unofficial fan-made project, not affiliated with, endorsed by, or representative of Tesla, Inc.
