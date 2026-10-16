# Roadster: Thrust Lab

**Roadster: Thrust Lab** is a browser-based, third-person stunt-driving playground inspired by the Tesla Roadster reveal and its rocket-assisted demonstration concept. It is built around experimentation rather than conventional racing: drive, build speed, launch, control the vehicle in the air, try unusual manoeuvres, and see whether you can land cleanly.

This is an independent fan project inspired by the idea and visual spectacle of a rocket-assisted Roadster. It is not an official Tesla product, is not endorsed by Tesla, and does not claim to reproduce Tesla's proprietary systems or undisclosed vehicle controls.

## Experience at a glance

- **Physics-driven driving:** acceleration, braking, steering, drag, suspension/contact response, and speed-dependent handling.
- **Rocket-assisted stunts:** rear and directional thrusters, a visible fuel reserve, airborne pitch/roll/yaw control, and automatic landing assistance.
- **Brake-to-drift handling:** sliding can emerge from braking while steering; there is no separate drift button.
- **Wall adhesion:** engage/release wall grip to ride steep surfaces and the circular wall-grip tunnel.
- **Distinct scenarios:** Launch Pad, Cliff Jump, Flight Lab, Wall Ride, and Wall-Grip Tunnel.
- **Landing feedback:** impact response, particles, and telemetry for speed, fuel, G-force, altitude, airtime, and jump distance.
- **Desktop and mobile UI:** keyboard controls, mouse camera orbit, virtual joystick, touch thruster buttons, compact mobile scenario selector, and responsive HUD.
- **Generated audio:** engine tone, thruster, tire-slip, and landing sounds are synthesized locally with the Web Audio API. The project does not require external audio recordings or downloaded sound files.

The vehicle uses one shared controller across scenarios. Each scenario changes the starting conditions and the course geometry so players can experiment with the same driving, thruster, and landing systems.

## Technology

- HTML and CSS for the interface and responsive layout
- JavaScript and Three.js for rendering and scene geometry
- A custom, lightweight physics integrator for driving, contact, thruster forces, and vehicle rotation
- Web Audio API for procedural sound effects

Three.js is loaded from jsDelivr, so an internet connection is required for the library. The project does not require a build step or package installation.

## Project structure

```text
thrust-lab-project/
├── index.html   # Page structure, HUD, scenario selector, controls and creator links
├── styles.css   # Responsive layout, HUD, desktop UI and mobile touch controls
├── script.js    # Scene, vehicle, custom physics, scenarios, camera, particles and generated audio
└── README.md    # Project overview and development notes
```

## Run locally

Serve the project over HTTP rather than opening `index.html` directly. With Python installed, run this command from the project directory:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

## Controls

### Desktop

| Input | Action |
| --- | --- |
| `W` / `S` | Accelerate / brake; pitch while airborne |
| `A` / `D` | Steer; roll while airborne |
| `Space` | Rear rocket thruster |
| `F` | Bottom thrusters |
| `Q` / `E` | Yaw while airborne |
| `Z` / `C` | Side thrusters in Manual mode |
| `Shift` | Hold wall grip |
| `G` | Toggle wall-grip system on or off |
| `M` | Switch AUTO / MANUAL thruster mode |
| Mouse drag | Orbit the camera; it returns to chase view after a short delay |
| `1`–`5` | Select a scenario |
| `R` | Reset the current scenario |
| `H` | Hide/show keyboard help |
| `Esc` | Open/close the intro overlay |

### Mobile

Use the on-screen joystick to accelerate/brake and steer. In the air, the joystick controls pitch and roll. Hold **ROCKET** for rear thrust, **LIFT** for bottom thrusters, and use **YAW** or **SIDE** for rotational and lateral thrust. **GRIP** toggles wall grip, and **AUTO** switches landing-assist modes. Open **Controls** for the on-screen guide.

## Where to tune the experience

Search `script.js` for these names:

- `wallRideConfig` — wall-ride dimensions, crest radius, and throw angle.
- `TUNNEL` — tunnel dimensions and world placement.
- `VEHICLE_MASS`, `VEHICLE_INERTIA`, `WHEEL_CONTACT_OFFSETS`, `CHASSIS_CONTACT_OFFSETS` — vehicle mass and contact layout.
- `updatePhysics()` — suspension/contact response, traction, drift, wall grip, thrusters, fuel usage, and landing assistance.
- `SCENARIOS` — each scenario's starting position and velocity.
- `initSound()`, `updateSound()`, `playLandingImpact()` — synthesized engine, thruster, tire-slip, and landing audio.
- `MOUSE_RETURN_DELAY` and `MOUSE_RETURN_DURATION` — camera look-return timing.

## Visual and product direction

The original product brief describes a premium, shareable vehicle playground: a compact stunt facility, distinctive ramps and targets, controlled airborne manoeuvres, convincing effects, cinematic but readable camera work, quick resets, and a responsive experience. Performance and clear feedback matter; visuals and effects should not obscure the driving surface or make the browser experience unstable.

The core idea is simple: **Drive it. Launch it. Rotate it. Try something ridiculous. See whether you can land it.**

## Credits and disclaimer

Created by [Muhammad Bilal Khan](https://x.com/Bk23544).

Inspired by the Tesla Roadster and the concept of rocket-assisted vehicle demonstrations. Tesla and Roadster are referenced for inspiration only. This is an unofficial fan-made project, not affiliated with, endorsed by, or representative of Tesla, Inc.
