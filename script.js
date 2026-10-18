import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, uniform, float, vec2, vec3, vec4, uv, texture, pass, instancedBufferAttribute,
    positionLocal, positionView, normalView, modelViewMatrix, screenDPR, lightTargetDirection,
    dot, fract, sin, floor, mix, smoothstep, step, pow, abs, max, min, clamp as tslClamp, saturate, select
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ---- game ---- */
const LINKS = [];
/* add {t:'Follow',u:'https://…'} entries for creator/social links */
LINKS.forEach(l => {
    const a = document.createElement('a');
    a.href = l.u;
    a.textContent = l.t;
    a.target = '_blank';
    a.rel = 'noopener';
    document.getElementById('lk').appendChild(a);
});

/* ======================================================================
   r128 -> r186 compatibility
   ====================================================================== */
/* Colour: r128 had no colour management, so hex/CSS colours were used as-is (linear).
   Keep that look by reading and writing hex/CSS values in the linear working space.
   Textures marked SRGBColorSpace are still decoded correctly. */
for (const m of ['setHex', 'setStyle', 'setColorName']) {
    const f = THREE.Color.prototype[m];
    THREE.Color.prototype[m] = function (v, cs = THREE.LinearSRGBColorSpace) { return f.call(this, v, cs); };
}
for (const m of ['getHex', 'getHexString', 'getStyle']) {
    const f = THREE.Color.prototype[m];
    THREE.Color.prototype[m] = function (cs = THREE.LinearSRGBColorSpace) { return f.call(this, cs); };
}
/* Lights: r128 used "legacy" lighting. Everything was scaled by PI, and point/spot lights
   faded linearly to their cut-off distance instead of following inverse-square falloff.
   These light classes reproduce that so the scene keeps the original balance. */
const legacyFalloff = (d, cutoff, decay) => select(cutoff.greaterThan(0).and(decay.greaterThan(0)), pow(saturate(d.div(cutoff).oneMinus()), decay), float(1));
class LegacyPointLight extends THREE.PointLight { constructor(color, intensity, distance = 0, decay = 1) { super(color, intensity, distance, decay); } }
class LegacySpotLight extends THREE.SpotLight { constructor(color, intensity, distance = 0, angle, penumbra, decay = 1) { super(color, intensity, distance, angle, penumbra, decay); } }
class LegacyPointLightNode extends THREE.PointLightNode {
    setupDirect(builder) {
        const lv = this.getLightVector(builder);
        return { lightDirection: lv.normalize(), lightColor: this.colorNode.mul(Math.PI).mul(legacyFalloff(lv.length(), this.cutoffDistanceNode, this.decayExponentNode)) };
    }
}
class LegacySpotLightNode extends THREE.SpotLightNode {
    setupDirect(builder) {
        const lv = this.getLightVector(builder), dir = lv.normalize();
        const spot = this.getSpotAttenuation(builder, dir.dot(lightTargetDirection(this.light)));
        return { lightDirection: dir, lightColor: this.colorNode.mul(Math.PI).mul(spot).mul(legacyFalloff(lv.length(), this.cutoffDistanceNode, this.decayExponentNode)) };
    }
}
const LEGACY_LIGHT = Math.PI;   /* intensity scale for hemisphere + directional lights */

const THREE_NS = THREE, createVector = (x = 0, y = 0, z = 0) => new THREE_NS.Vector3(x, y, z), getElement = id => document.getElementById(id);
/* ---- loading screen: #loader is in the HTML so it shows while modules download; it fades once the model, shaders and first frames are ready ---- */
const loadScreen = {
    el: document.getElementById('loader'), bar: document.getElementById('loader-bar'), msg: document.getElementById('loader-msg'),
    pct: document.getElementById('loader-pct'), done: false, modelReady: false, compiled: false, frames: 0, value: 0,
    set(v, text) {
        this.value = Math.max(this.value, Math.min(1, v));
        if (this.bar) this.bar.style.width = (this.value * 100).toFixed(0) + '%';
        if (this.pct) this.pct.textContent = (this.value * 100).toFixed(0) + '%';
        if (text && this.msg) this.msg.textContent = text;
    },
    finish() {
        if (this.done || !this.el) return;
        this.done = true;
        this.set(1, 'Ready');
        document.body.classList.add('loaded');
        this.el.classList.add('hide');
        setTimeout(() => this.el.remove(), 900);
    },
    check() {
        if (this.modelReady && this.compiled && this.frames >= 3) this.finish();
    }
};
loadScreen.set(.1, 'Starting renderer');
setTimeout(() => loadScreen.finish(), 25000);   /* never trap the player behind the loader */

const renderer = new THREE_NS.WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE_NS.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

/* ======================================================================
   SETUP: renderer, scene, dusk sky, skyline, lighting
   ====================================================================== */
const sunDir = new THREE_NS.Vector3(-.30, .42, .86).normalize();      // moon (visual only)
const lightDir = new THREE_NS.Vector3(-.35, .80, .48).normalize();    // key light direction (form + shadows)
const FOG_COL = new THREE_NS.Color(.003, .009, .02);
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE_NS.PCFShadowMap;   /* PCFSoftShadowMap is not available with WebGPU */
renderer.library.addLight(LegacyPointLightNode, LegacyPointLight);
renderer.library.addLight(LegacySpotLightNode, LegacySpotLight);
getElement('c').appendChild(renderer.domElement);
await renderer.init();   /* WebGPU, or WebGL 2 when WebGPU is unavailable */
loadScreen.set(.2, 'Building the test facility');
const scene = new THREE_NS.Scene();
scene.background = FOG_COL.clone();
scene.fog = new THREE_NS.Fog(FOG_COL, 60, 1100);
const camera = new THREE_NS.PerspectiveCamera(62, 1, .25, 3200);
window.__camRef = camera;

/* ---- sky dome (shader): gradient, sun, stars, clouds ---- */
const skyTime = uniform(0), skySun = uniform(sunDir);
const hash21 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
const noise21 = Fn(([p]) => {
    const i = floor(p), f = fract(p).toVar();
    f.assign(f.mul(f).mul(f.mul(-2).add(3)));
    return mix(mix(hash21(i), hash21(i.add(vec2(1, 0))), f.x), mix(hash21(i.add(vec2(0, 1))), hash21(i.add(vec2(1, 1))), f.x), f.y);
});
const fbm2 = Fn(([p0]) => {
    const p = vec2(p0).toVar(), a = float(.5).toVar(), s = float(0).toVar();
    Loop(4, () => { s.addAssign(a.mul(noise21(p))); p.assign(p.mul(2.03).add(vec2(7.1, 3.7))); a.mulAssign(.5); });
    return s;
});
const skyMat = new THREE_NS.MeshBasicNodeMaterial({ side: THREE_NS.BackSide, depthWrite: false, fog: false });
skyMat.fragmentNode = Fn(() => {
    const d = positionLocal.normalize().toVar(), h = d.y;
    const zen = vec3(.0006, .0015, .007), mid = vec3(.002, .007, .020), hor = vec3(.008, .03, .055), haze = vec3(.004, .012, .024);
    const sd = max(dot(d, skySun), 0).toVar();
    const c = mix(hor, mid, smoothstep(0, .26, h)).toVar();
    c.assign(mix(c, zen, smoothstep(.2, .9, h)));
    /* moon: cold white disc, halo */
    c.addAssign(vec3(.35, .5, .8).mul(pow(sd, 9)).mul(.30).add(vec3(.6, .8, 1.2).mul(pow(sd, 80)).mul(.55)));
    c.addAssign(vec3(3.4, 3.7, 4.3).mul(smoothstep(.99935, .99955, sd)));
    /* distant facility glow on the horizon */
    c.addAssign(vec3(.05, .35, .55).mul(smoothstep(.16, 0, abs(h.sub(.01)))).mul(.20));
    /* stars */
    const fc = floor(d.xz.div(abs(h).add(.35)).mul(90)), hs = hash21(fc);
    const tw = sin(skyTime.mul(2.5).add(hs.mul(60))).mul(.4).add(.6);
    c.addAssign(mix(vec3(.7, .85, 1), vec3(1, .95, .85), hash21(fc.add(3))).mul(step(.9935, hs)).mul(tw).mul(smoothstep(.04, .4, h)).mul(2.2));
    const st2 = step(.985, hash21(floor(d.xz.div(abs(h).add(.35)).mul(210)).add(9)));
    c.addAssign(vec3(.5, .6, .9).mul(st2).mul(smoothstep(.1, .5, h)).mul(.55));
    /* very thin high cloud, barely lit by the moon */
    If(h.greaterThan(.05), () => {
        const cl = smoothstep(.55, .85, fbm2(d.xz.div(h.add(.2)).mul(1.1).add(vec2(skyTime.mul(.004), 0))));
        c.assign(mix(c, vec3(.03, .05, .10).add(vec3(.10, .14, .22).mul(pow(sd, 3))), cl.mul(.55).mul(smoothstep(.05, .2, h)).mul(smoothstep(.5, .9, h).oneMinus())));
    });
    c.assign(mix(c, haze, smoothstep(-.10, 0, h).oneMinus()));
    return vec4(c, 1);
})();
const skyDome = new THREE_NS.Mesh(new THREE_NS.SphereGeometry(2400, 40, 24), skyMat);
skyDome.renderOrder = -10;
skyDome.frustumCulled = false;
scene.add(skyDome);

/* ---- distant mountains (vertical haze gradient) ---- */
const mtns = [];
const mountainRing = (r, hMin, hMax, colTop, colBot, seed) => {
    const N = 300, pos = [], col = [], idx = [];
    for (let i = 0; i <= N; i++) {
        const a = i / N * Math.PI * 2, n = Math.sin(a * 7 + seed) * .45 + Math.sin(a * 19 + seed * 2) * .3 + Math.sin(a * 43 + seed * 3) * .15 + Math.sin(a * 97 + seed) * .1;
        const h = hMin + (hMax - hMin) * (n * .5 + .5), cx = Math.cos(a) * r, cz = Math.sin(a) * r;
        pos.push(cx, -20, cz, cx, h, cz);
        col.push(colBot.r, colBot.g, colBot.b, colTop.r, colTop.g, colTop.b);
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE_NS.BufferGeometry();
    g.setAttribute('position', new THREE_NS.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE_NS.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE_NS.Mesh(g, new THREE_NS.MeshBasicMaterial({ vertexColors: true, side: THREE_NS.DoubleSide, fog: false }));
    m.frustumCulled = false;
    scene.add(m);
    mtns.push(m);
};
mountainRing(1500, 30, 150, new THREE_NS.Color(.006, .014, .03), new THREE_NS.Color(.01, .03, .055), 1);
mountainRing(1150, 20, 90, new THREE_NS.Color(.008, .018, .035), new THREE_NS.Color(.015, .04, .07), 5);

/* ---- shared canvas helpers / textures ---- */
const mkCanvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const canvasTex = (c, rep) => { const t = new THREE_NS.CanvasTexture(c); t.colorSpace = THREE_NS.SRGBColorSpace; t.wrapS = t.wrapT = THREE_NS.RepeatWrapping; t.anisotropy = 8; if (rep) t.repeat.set(rep[0], rep[1]); return t; };
const noiseFill = (x, w, h, amp) => {
    const id = x.getImageData(0, 0, w, h);
    for (let i = 0; i < id.data.length; i += 4) { const n = (Math.random() - .5) * amp; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n * 1.2; }
    x.putImageData(id, 0, 0);
};

/* ---- skyline of a far-off neon city ---- */
{
    const [wc, wx] = mkCanvas(64);
    wx.fillStyle = '#04070d'; wx.fillRect(0, 0, 64, 64);
    const cols = ['#ffb0bf', '#ff7d8e', '#fff6e8', '#ff6a4f', '#ffe2b0', '#ffffff'];
    for (let r = 0; r < 8; r++) for (let q = 0; q < 8; q++) {
        if (Math.random() < .30) { wx.fillStyle = cols[(Math.random() * cols.length) | 0]; wx.globalAlpha = .55 + Math.random() * .45; wx.fillRect(q * 8 + 2, r * 8 + 2, 4, 4); }
    }
    wx.globalAlpha = 1;
    const winTex = canvasTex(wc);
    winTex.magFilter = THREE_NS.NearestFilter;
    const pos = [], nor = [], uv = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const quad = (a, b, c, d, n, u0, uw, vh) => {
        [a, b, c, a, c, d].forEach(p => pos.push(...p));
        for (let i = 0; i < 6; i++) nor.push(...n);
        uv.push(u0, 0, u0 + uw, 0, u0 + uw, vh, u0, 0, u0 + uw, vh, u0, vh);
    };
    for (let i = 0; i < 520; i++) {
        const a = rnd() * Math.PI * 2, r = 760 + rnd() * 160 + (rnd() < .12 ? 40 : 0);
        const w = 14 + rnd() * 30, dp = 14 + rnd() * 30, tall = Math.pow(rnd(), 2.2);
        const h = 25 + tall * 190 * (.5 + .5 * Math.max(0, Math.sin(a * 2.0 + 1)));
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r, ca = Math.cos(a), sa = Math.sin(a);
        const rot = (lx, lz) => [cx + lx * ca - lz * sa, 0, cz + lx * sa + lz * ca];
        const p00 = rot(-w / 2, -dp / 2), p10 = rot(w / 2, -dp / 2), p11 = rot(w / 2, dp / 2), p01 = rot(-w / 2, dp / 2);
        const up = p => [p[0], h, p[2]], dn = p => [p[0], -4, p[2]];
        const u0 = rnd(), tw = Math.max(1, Math.round(w / 6)) / 8, th = Math.max(1, Math.round(h / 6)) / 8;
        quad(dn(p00), dn(p10), up(p10), up(p00), [0, 0, -1], u0, tw, th);
        quad(dn(p10), dn(p11), up(p11), up(p10), [1, 0, 0], u0, tw, th);
        quad(dn(p11), dn(p01), up(p01), up(p11), [0, 0, 1], u0, tw, th);
        quad(dn(p01), dn(p00), up(p00), up(p01), [-1, 0, 0], u0, tw, th);
        /* rooftop beacon strip */
    }
    const g = new THREE_NS.BufferGeometry();
    g.setAttribute('position', new THREE_NS.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE_NS.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE_NS.Float32BufferAttribute(uv, 2));
    const city = new THREE_NS.Mesh(g, new THREE_NS.MeshBasicMaterial({ map: winTex, color: new THREE_NS.Color(2.0, 1.7, 1.7), side: THREE_NS.DoubleSide }));
    city.frustumCulled = false;
    scene.add(city);
    mtns.push(city);
}

/* ---- stars ---- */
{
    const n = 700, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const th = Math.random() * 6.28, ph = Math.acos(Math.random() * .85 + .15);
        a[i * 3] = 1800 * Math.sin(ph) * Math.cos(th);
        a[i * 3 + 1] = 1800 * Math.cos(ph);
        a[i * 3 + 2] = 1800 * Math.sin(ph) * Math.sin(th);
    }
    /* WebGPU draws native points at 1px, so sized points are instanced sprites */
    const stars = new THREE_NS.Sprite(new THREE_NS.PointsNodeMaterial({ size: 1.5, sizeAttenuation: false, color: 0xc8dcff, fog: false, positionNode: instancedBufferAttribute(new THREE_NS.InstancedBufferAttribute(a, 3)) }));
    stars.count = n;
    stars.frustumCulled = false;
    scene.add(stars);
}

/* ---- image based lighting: matches the sky so the paint picks up sunset colours ---- */
{
    const e2 = new THREE_NS.Scene();
    const g = new THREE_NS.SphereGeometry(50, 64, 32), pa = g.attributes.position, col = [];
    const Z = [.0006, .0015, .007], M = [.002, .007, .02], H = [.008, .03, .055], HZ = [.004, .012, .024];
    const sm = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    for (let i = 0; i < pa.count; i++) {
        const d = new THREE_NS.Vector3(pa.getX(i), pa.getY(i), pa.getZ(i)).normalize(), h = d.y, s = Math.max(0, d.dot(sunDir));
        const k1 = sm(0, .30, h), k2 = sm(.22, .92, h), kb = 1 - sm(-.10, 0, h);
        [0, 1, 2].forEach(j => {
            let v = H[j] + (M[j] - H[j]) * k1; v += (Z[j] - v) * k2;
            v += [.35, .5, .8][j] * Math.pow(s, 9) * .3 + [.6, .8, 1.2][j] * Math.pow(s, 80) * .5;
            v = v + (HZ[j] * .9 - v) * kb;
            col.push(v);
        });
    }
    g.setAttribute('color', new THREE_NS.Float32BufferAttribute(col, 3));
    e2.add(new THREE_NS.Mesh(g, new THREE_NS.MeshBasicMaterial({ vertexColors: true, side: THREE_NS.BackSide })));
    const sb = (w, h, p, c, k) => {
        const m = new THREE_NS.Mesh(new THREE_NS.PlaneGeometry(w, h), new THREE_NS.MeshBasicMaterial({ color: new THREE_NS.Color(c).multiplyScalar(k), side: THREE_NS.DoubleSide }));
        m.position.set(...p);
        m.lookAt(0, 0, 0);
        e2.add(m);
    };
    sb(34, 9, [0, 38, 0], 0xcfe4ff, 1.5);                                                     // overhead cold softbox (floodlit range)
    sb(16, 5, [sunDir.x * 40, sunDir.y * 40 + 2, sunDir.z * 40], 0xdfeaff, 2.4);               // moon
    sb(30, 3, [-38, 6, 6], 0x39c8ff, 1.8);                                                     // cyan side strip
    sb(30, 3, [38, 6, -6], 0xe8f4ff, 1.5);                                                     // white side strip
    sb(30, 2, [0, 5, -40], 0x3a7bff, 1.6);                                                     // blue rear kicker
    scene.environment = new THREE_NS.PMREMGenerator(renderer).fromScene(e2, .015).texture;
}
const ambient = new THREE_NS.HemisphereLight(0x5a2d30, 0x080404, 0.52 * LEGACY_LIGHT);
scene.add(ambient);
const fillLight = new THREE_NS.DirectionalLight(0xff4050, 0.40 * LEGACY_LIGHT);
fillLight.position.set(-42, 28, -35);
scene.add(fillLight);
const key = new THREE_NS.DirectionalLight(0xffd4c0, .85 * LEGACY_LIGHT);
key.position.set(40, 80, 30);
key.castShadow = false;
key.shadow.mapSize.set(2048, 2048);
const shc = key.shadow.camera;
shc.left = shc.bottom = -34;
shc.right = shc.top = 34;
shc.near = 1;
shc.far = 300;
key.shadow.bias = -.0004;
key.shadow.radius = 3;
key.shadow.normalBias = .05;
scene.add(key, key.target);

/* ======================================================================
   WORLD ENGINE: analytic height-field, profile surfaces, batched meshes
   ====================================================================== */
const CELL = 32, heightGrid = new Map(), heightRegions = [];
const cellKey = (i, j) => (i + 256) * 1024 + (j + 256);
function addHeightRegion(x0, x1, z0, z1, f) {
    const r = { x0, x1, z0, z1, f };
    heightRegions.push(r);
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
        for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
            const k = cellKey(i, j);
            let a = heightGrid.get(k);
            if (!a) heightGrid.set(k, a = []);
            a.push(r);
        }
    return r;
}
function getSurfaceHeight(x, z) {
    const a = heightGrid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!a) return 0;
    let h = 0;
    for (let i = 0; i < a.length; i++) {
        const r = a[i];
        if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) { const v = r.f(x, z); if (v > h) h = v; }
    }
    return h;
}

/* ---- profile surfaces: curved walls extruded sideways (steeper than the height-field allows) ---- */
const profiles = [];
function addProfile(o) {
    const segs = [];
    let minU = 1e9, maxU = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < o.pts.length - 1; i++) {
        const a = o.pts[i], b = o.pts[i + 1], du = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(du, dy);
        if (len < 1e-6) continue;
        segs.push({ u0: a[0], y0: a[1], du, dy, len2: len * len, len, nu: -dy / len, ny: du / len, first: i === 0, last: i === o.pts.length - 2 });
    }
    o.pts.forEach(p => { minU = Math.min(minU, p[0]); maxU = Math.max(maxU, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
    const lm = o.exact ? 0 : .25;
    const pr = { ax: o.ax, clip: !!o.clip, segs, bb: [o.l0 - lm, o.l1 + lm, minU - 3, maxU + 3, o.exact ? -50 : minY - 3, maxY + 4] };
    profiles.push(pr);
    return pr;
}
function profileContactOne(pr, P) {
    const l = pr.ax === 'z' ? P.x : P.z, u = pr.ax === 'z' ? P.z : P.x;
    const bb = pr.bb;
    if (l < bb[0] || l > bb[1] || u < bb[2] || u > bb[3] || P.y < bb[4] || P.y > bb[5]) return null;
    let bestD2 = Infinity, bestS = 0, bnu = 0, bny = 1;
    for (let i = 0; i < pr.segs.length; i++) {
        const s = pr.segs[i];
        let t = ((u - s.u0) * s.du + (P.y - s.y0) * s.dy) / s.len2;
        if (pr.clip && ((s.first && t < 0) || (s.last && t > 1))) continue;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ou = u - (s.u0 + s.du * t), oy = P.y - (s.y0 + s.dy * t), d2 = ou * ou + oy * oy;
        if (d2 >= bestD2) continue;
        bestD2 = d2;
        bestS = oy * s.ny + ou * s.nu;
        bnu = s.nu; bny = s.ny;
    }
    if (bestD2 > 2.8 * 2.8) return null;
    return [bestS, pr.ax === 'z' ? createVector(0, bny, bnu) : createVector(bnu, bny, 0)];
}
function getProfileContact(P) {
    let best = null;
    for (let i = 0; i < profiles.length; i++) {
        const c = profileContactOne(profiles[i], P);
        if (c && (!best || c[0] < best[0])) best = c;
    }
    return best;
}

/* ---- textures ---- */
const gridTexture = (base, minor, major, size, cells) => {
    const [c, x] = mkCanvas(size);
    x.fillStyle = base; x.fillRect(0, 0, size, size);
    noiseFill(x, size, size, 10);
    const st = size / cells;
    x.strokeStyle = minor; x.lineWidth = 2; x.beginPath();
    for (let i = 1; i < cells; i++) { x.moveTo(i * st, 0); x.lineTo(i * st, size); x.moveTo(0, i * st); x.lineTo(size, i * st); }
    x.stroke();
    x.strokeStyle = major; x.lineWidth = 5; x.strokeRect(0, 0, size, size);
    return canvasTex(c);
};
const texFloor = gridTexture('#070b12', '#220a10', '#a81f3a', 512, 8);
texFloor.repeat.set(2400 / 64, 2400 / 64); texFloor.anisotropy = 16;
const texTerrain = gridTexture('#15100c', '#3a1a1a', '#c4302f', 256, 8);
const texPanel = (() => {
    const [c, x] = mkCanvas(256);
    x.fillStyle = '#56606c'; x.fillRect(0, 0, 256, 256);
    noiseFill(x, 256, 256, 18);
    const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, 'rgba(255,255,255,.07)'); g.addColorStop(1, 'rgba(0,0,0,.16)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(0,0,0,.75)'; x.lineWidth = 5; x.strokeRect(2.5, 2.5, 251, 251);
    x.strokeStyle = 'rgba(150,215,255,.30)'; x.lineWidth = 1.5; x.strokeRect(8, 8, 240, 240);
    x.strokeStyle = 'rgba(0,0,0,.4)'; x.lineWidth = 2; x.beginPath(); x.moveTo(128, 10); x.lineTo(128, 246); x.moveTo(10, 128); x.lineTo(246, 128); x.stroke();
    x.fillStyle = 'rgba(190,230,255,.38)';
    [[16, 16], [240, 16], [16, 240], [240, 240]].forEach(p => { x.beginPath(); x.arc(p[0], p[1], 3, 0, 6.3); x.fill(); });
    return canvasTex(c);
})();
const texRoad = (() => {
    const [c, x] = mkCanvas(128, 256);
    x.fillStyle = '#0d1219'; x.fillRect(0, 0, 128, 256);
    noiseFill(x, 128, 256, 14);
    x.fillStyle = 'rgba(255,190,200,.7)'; x.fillRect(8, 0, 4, 256); x.fillRect(116, 0, 4, 256);
    x.fillStyle = 'rgba(255,110,120,.6)'; x.fillRect(62, 18, 4, 100);
    const t = canvasTex(c); return t;
})();
const texChevron = (() => {
    /* calibration ruler: fine cross-lines with tick marks, reads as a measurement scale on ramps */
    const [c, x] = mkCanvas(128);
    x.shadowColor = '#ff5a6e'; x.shadowBlur = 6; x.fillStyle = '#ffffff';
    x.fillRect(0, 62, 128, 3);
    [0, 16, 32, 48, 80, 96, 112].forEach(y => x.fillRect(44, y, 40, 2));
    x.fillRect(6, 0, 3, 128); x.fillRect(119, 0, 3, 128);
    const t = new THREE_NS.CanvasTexture(c); t.colorSpace = THREE_NS.SRGBColorSpace; t.wrapS = t.wrapT = THREE_NS.RepeatWrapping; t.anisotropy = 8;
    return t;
})();

/* ---- materials ---- */
const solidMat = new THREE_NS.MeshStandardMaterial({ map: texPanel, vertexColors: true, roughness: .52, metalness: .38, envMapIntensity: 1.0, side: THREE_NS.DoubleSide });
const thinMat = new THREE_NS.MeshStandardMaterial({ map: texPanel, vertexColors: true, roughness: .5, metalness: .42, envMapIntensity: 1.0, side: THREE_NS.DoubleSide });
const neonMat = new THREE_NS.MeshBasicMaterial({ vertexColors: true });
const decalMat = new THREE_NS.MeshBasicMaterial({ map: texChevron, vertexColors: true, transparent: true, blending: THREE_NS.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
const terrainMat = new THREE_NS.MeshStandardMaterial({ map: texTerrain, vertexColors: true, roughness: .72, metalness: .15, envMapIntensity: .55 });
const roadMat = new THREE_NS.MeshStandardMaterial({ map: texRoad, roughness: .55, metalness: .2, envMapIntensity: .6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

const labHex = h => { const c = new THREE_NS.Color(h), l = labCol([c.r, c.g, c.b]); return '#' + new THREE_NS.Color().setRGB(l[0], l[1], l[2]).getHexString(); };
/* ---- geometry batch ---- */
const _sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const _cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const _dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const _norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/* lab palette: reds/pinks/violets -> ice cyan or electric blue, greens -> teal, orange/yellow -> safety amber */
const _labCache = new Map();
function labCol(c) {
    const key = c[0] + ',' + c[1] + ',' + c[2];
    let r = _labCache.get(key);
    if (r) return r;
    const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[2], c[1]);
    if (mx - mn < .22 * mx || mx <= 0) { _labCache.set(key, c); return c; }
    const d = mx - mn;
    let h = mx === c[0] ? ((c[1] - c[2]) / d + 6) % 6 : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
    h *= 60;
    let nh, sat = d / mx;
    if (h >= 25 && h < 75) { nh = 38; }
    else { nh = 355; }
    sat = Math.min(1, sat * .85);
    const f = nh / 60, i = Math.floor(f) % 6, ff = f - Math.floor(f), p = mx * (1 - sat), q = mx * (1 - sat * ff), t = mx * (1 - sat * (1 - ff));
    r = [[mx, t, p], [q, mx, p], [p, mx, t], [p, q, mx], [t, p, mx], [mx, p, q]][i];
    _labCache.set(key, r);
    return r;
}
class Batch {
    constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
    vert(p, n, uv, c) { c = labCol(c); this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.u.push(uv[0], uv[1]); this.c.push(c[0], c[1], c[2]); }
    tri(pa, pb, pc, na, nb, nc, ua, ub, uc, col) { this.vert(pa, na, ua, col); this.vert(pb, nb, ub, col); this.vert(pc, nc, uc, col); }
    quad(a, b, c, d, col, o = {}) {
        let n = _cross(_sub(b, a), _sub(c, a)), len = Math.hypot(n[0], n[1], n[2]);
        if (len < 1e-7) { n = _cross(_sub(c, a), _sub(d, a)); len = Math.hypot(n[0], n[1], n[2]); if (len < 1e-7) return; }
        n = [n[0] / len, n[1] / len, n[2] / len];
        const T = o.tile || 4;
        let uv = o.uv;
        if (!uv) {
            const f = p => Math.abs(n[1]) > .6 ? [p[0] / T, p[2] / T] : (Math.abs(n[0]) > Math.abs(n[2]) ? [p[2] / T, p[1] / T] : [p[0] / T, p[1] / T]);
            uv = [f(a), f(b), f(c), f(d)];
        }
        let flip = false;
        if (o.hint) flip = _dot(n, o.hint) < 0;
        else if (o.inside) { const cx = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4]; flip = _dot(n, _sub(cx, o.inside)) < 0; }
        if (flip) { n = [-n[0], -n[1], -n[2]]; this.tri(a, d, c, n, n, n, uv[0], uv[3], uv[2], col); this.tri(a, c, b, n, n, n, uv[0], uv[2], uv[1], col); }
        else { this.tri(a, b, c, n, n, n, uv[0], uv[1], uv[2], col); this.tri(a, c, d, n, n, n, uv[0], uv[2], uv[3], col); }
    }
    mesh(mat, cast = true, recv = true) {
        if (!this.p.length) return null;
        const g = new THREE_NS.BufferGeometry();
        g.setAttribute('position', new THREE_NS.Float32BufferAttribute(this.p, 3));
        g.setAttribute('normal', new THREE_NS.Float32BufferAttribute(this.n, 3));
        g.setAttribute('uv', new THREE_NS.Float32BufferAttribute(this.u, 2));
        g.setAttribute('color', new THREE_NS.Float32BufferAttribute(this.c, 3));
        g.computeBoundingSphere();
        const m = new THREE_NS.Mesh(g, mat);
        m.castShadow = cast; m.receiveShadow = recv;
        return m;
    }
}
function aabb(B, x0, x1, y0, y1, z0, z1, col, o = {}) {
    const ins = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], op = Object.assign({ inside: ins }, o), P = (x, y, z) => [x, y, z];
    B.quad(P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1), col, op);
    B.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0), col, op);
    B.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), col, op);
    B.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), col, op);
    B.quad(P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), col, op);
}
function boxBetween(B, a, b, w, t, col, o = {}) {
    const d = _norm(_sub(b, a)), ref = Math.abs(d[1]) > .95 ? [1, 0, 0] : [0, 1, 0], s = _norm(_cross(d, ref)), u = _cross(s, d);
    const C = (p, sx, uy) => [p[0] + s[0] * sx * w / 2 + u[0] * uy * t / 2, p[1] + s[1] * sx * w / 2 + u[1] * uy * t / 2, p[2] + s[2] * sx * w / 2 + u[2] * uy * t / 2];
    const ins = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], op = Object.assign({ inside: ins, tile: 4 }, o);
    const a1 = C(a, -1, -1), a2 = C(a, 1, -1), a3 = C(a, 1, 1), a4 = C(a, -1, 1), b1 = C(b, -1, -1), b2 = C(b, 1, -1), b3 = C(b, 1, 1), b4 = C(b, -1, 1);
    B.quad(a1, a2, b2, b1, col, op); B.quad(a2, a3, b3, b2, col, op); B.quad(a3, a4, b4, b3, col, op); B.quad(a4, a1, b1, b4, col, op);
    B.quad(a1, a2, a3, a4, col, op); B.quad(b1, b2, b3, b4, col, op);
}
function cyl(B, cx, cz, r, y0, y1, col, o = {}) {
    const seg = o.seg || 24, T = o.tile || 4;
    for (let i = 0; i < seg; i++) {
        const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        const p00 = [cx + c0 * r, y0, cz + s0 * r], p10 = [cx + c1 * r, y0, cz + s1 * r], p01 = [cx + c0 * r, y1, cz + s0 * r], p11 = [cx + c1 * r, y1, cz + s1 * r];
        const n0 = [c0, 0, s0], n1 = [c1, 0, s1], u0 = a0 * r / T, u1 = a1 * r / T, v0 = y0 / T, v1 = y1 / T;
        B.tri(p00, p10, p11, n0, n1, n1, [u0, v0], [u1, v0], [u1, v1], col);
        B.tri(p00, p11, p01, n0, n1, n0, [u0, v0], [u1, v1], [u0, v1], col);
        if (!o.noTop) B.tri([cx, y1, cz], p11, p01, [0, 1, 0], [0, 1, 0], [0, 1, 0], [cx / T, cz / T], [p11[0] / T, p11[2] / T], [p01[0] / T, p01[2] / T], col);
    }
}

/* ---- zones: each zone owns its own batched meshes so culling still works ---- */
const zones = [];
function makeZone(name, accent, rect) {
    const c = new THREE_NS.Color(accent); { const l = labCol([c.r, c.g, c.b]); c.setRGB(l[0], l[1], l[2]); }
    const Z = { name, rect, accent: c, hdr: [c.r * 2.4, c.g * 2.4, c.b * 2.4], soft: [c.r * .9, c.g * .9, c.b * .9], solid: new Batch(), thin: new Batch(), neon: new Batch(), decal: new Batch() };
    zones.push(Z);
    return Z;
}
function finalizeZones() {
    zones.forEach(Z => {
        [[Z.solid, solidMat, true, true], [Z.thin, thinMat, true, true], [Z.neon, neonMat, false, false], [Z.decal, decalMat, false, false]].forEach(([b, m, cs, rs]) => {
            const mesh = b.mesh(m, cs, rs);
            if (mesh) { if (m === decalMat) mesh.renderOrder = 2; scene.add(mesh); }
        });
    });
}
const BODY = [1, 1, 1];
function neonPath(Z, pts, w, t, col, closed) {
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) boxBetween(Z.neon, pts[i], pts[i + 1], w, t, col);
    if (closed) boxBetween(Z.neon, pts[n - 1], pts[0], w, t, col);
}
function lift(p, y) { return [p[0], p[1] + y, p[2]]; }
function chevronQuad(Z, a, b, c, d, nu, nv, col) {
    Z.decal.quad(a, b, c, d, col, { uv: [[0, 0], [nu, 0], [nu, nv], [0, nv]], hint: [0, 1, 0] });
}

/* ---- builders ---- */
function ramp(Z, o) {
    const { x0, x1, z0, z1, h0, h1 } = o, ax = o.axis || 'z';
    addHeightRegion(x0, x1, z0, z1, ax === 'z' ? (x, z) => h0 + (h1 - h0) * (z - z0) / (z1 - z0) : (x, z) => h0 + (h1 - h0) * (x - x0) / (x1 - x0));
    const hA = h0, hB = ax === 'z' ? h0 : h1, hC = h1, hD = ax === 'z' ? h1 : h0;
    const A = [x0, hA, z0], B = [x1, hB, z0], C = [x1, hC, z1], D = [x0, hD, z1];
    const col = o.col || BODY, ins = [(x0 + x1) / 2, 0, (z0 + z1) / 2], S = Z.solid;
    S.quad(A, D, C, B, col, { hint: [0, 1, 0] });
    S.quad(A, B, [x1, 0, z0], [x0, 0, z0], col, { inside: ins });
    S.quad(B, C, [x1, 0, z1], [x1, 0, z0], col, { inside: ins });
    S.quad(C, D, [x0, 0, z1], [x1, 0, z1], col, { inside: ins });
    S.quad(D, A, [x0, 0, z0], [x0, 0, z1], col, { inside: ins });
    const nc = o.neon || Z.hdr;
    const up = .08;
    neonPath(Z, [lift(A, up), lift(B, up), lift(C, up), lift(D, up)], .3, .16, nc, true);
    if (o.chev !== false) {
        const ins2 = .9, wd = (ax === 'z' ? x1 - x0 : z1 - z0), len = (ax === 'z' ? z1 - z0 : x1 - x0);
        const f = (x, z) => [x, (ax === 'z' ? h0 + (h1 - h0) * (z - z0) / (z1 - z0) : h0 + (h1 - h0) * (x - x0) / (x1 - x0)) + .05, z];
        const dir = o.dirFlip ? -1 : 1;
        const nu = Math.max(1, Math.round((wd - 2 * ins2) / 7)), nv = Math.max(1, Math.round((len - 2 * ins2) / 6)) * dir;
        const cc = o.chevCol || Z.soft;
        if (ax === 'z') chevronQuad(Z, f(x0 + ins2, z0 + ins2), f(x1 - ins2, z0 + ins2), f(x1 - ins2, z1 - ins2), f(x0 + ins2, z1 - ins2), nu, nv, cc);
        else Z.decal.quad(f(x0 + ins2, z0 + ins2), f(x0 + ins2, z1 - ins2), f(x1 - ins2, z1 - ins2), f(x1 - ins2, z0 + ins2), cc, { uv: [[0, 0], [nu, 0], [nu, nv], [0, nv]], hint: [0, 1, 0] });
    }
}
function block(Z, o) {
    const { x0, x1, z0, z1, h } = o;
    addHeightRegion(x0, x1, z0, z1, () => h);
    aabb(Z.solid, x0, x1, 0, h, z0, z1, o.col || BODY, { tile: o.tile || 4 });
    if (o.neon !== false) {
        const nc = o.neon || Z.hdr, y = h + .08;
        neonPath(Z, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], o.nw || .28, .16, nc, true);
    }
}
function hip(Z, o) {
    const { cx, cz, hx, hz, H, slope } = o;
    addHeightRegion(cx - hx, cx + hx, cz - hz, cz + hz, (x, z) => Math.min(H, slope * Math.min(hx - Math.abs(x - cx), hz - Math.abs(z - cz))));
    const inset = H / slope, tx = Math.max(0, hx - inset), tz = Math.max(0, hz - inset), Hh = Math.min(H, slope * Math.min(hx, hz));
    const col = o.col || BODY, S = Z.solid, ins = [cx, Hh / 2, cz];
    const O = [[cx - hx, 0, cz - hz], [cx + hx, 0, cz - hz], [cx + hx, 0, cz + hz], [cx - hx, 0, cz + hz]];
    const I = [[cx - tx, Hh, cz - tz], [cx + tx, Hh, cz - tz], [cx + tx, Hh, cz + tz], [cx - tx, Hh, cz + tz]];
    for (let i = 0; i < 4; i++) S.quad(O[i], O[(i + 1) % 4], I[(i + 1) % 4], I[i], col, { inside: ins });
    S.quad(I[0], I[1], I[2], I[3], col, { hint: [0, 1, 0] });
    if (o.neon !== false) neonPath(Z, I.map(p => lift(p, .08)), .26, .14, o.neon || Z.hdr, true);
    if (o.neon !== false) for (let i = 0; i < 4; i++) boxBetween(Z.neon, lift(O[i], .05), lift(I[i], .08), .16, .1, o.neon || Z.hdr);
}
function pillar(Z, o) {
    const { cx, cz, r, h } = o;
    addHeightRegion(cx - r, cx + r, cz - r, cz + r, (x, z) => (Math.hypot(x - cx, z - cz) < r ? h : 0));
    cyl(Z.solid, cx, cz, r, 0, h, o.col || BODY, { seg: o.seg || 20 });
    if (o.neon !== false) {
        cyl(Z.neon, cx, cz, r + .04, h - .35, h - .1, o.neon || Z.hdr, { seg: o.seg || 20, noTop: true });
        if (o.base !== false) cyl(Z.neon, cx, cz, r + .04, .25, .4, o.neon || Z.hdr, { seg: o.seg || 20, noTop: true });
    }
}
/* grid mesh for smooth terrain features */
function terrainMesh(o) {
    const { x0, x1, z0, z1 } = o, step = o.step || 2, nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
    const dx = (x1 - x0) / nx, dz = (z1 - z0) / nz, pos = new Float32Array((nx + 1) * (nz + 1) * 3), col = new Float32Array((nx + 1) * (nz + 1) * 3), uv = new Float32Array((nx + 1) * (nz + 1) * 2);
    const T = o.tile || 32, tint = o.tint || [1, 1, 1], H = o.H || 10;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const k = j * (nx + 1) + i, x = x0 + i * dx, z = z0 + j * dz, y = o.f(x, z);
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        uv[k * 2] = x / T; uv[k * 2 + 1] = z / T;
        const b = .65 + .9 * Math.min(1, y / H);
        col[k * 3] = tint[0] * b; col[k * 3 + 1] = tint[1] * b; col[k * 3 + 2] = tint[2] * b;
    }
    const idx = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + (nx + 1) + 1, d = a + (nx + 1);
        idx.push(a, d, c, a, c, b);
    }
    const g = new THREE_NS.BufferGeometry();
    g.setAttribute('position', new THREE_NS.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE_NS.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE_NS.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE_NS.Mesh(g, terrainMat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return m;
}
/* a curved wall (profile) extruded between l0..l1; pts are [u, y] with free space on the left of travel */
function profileSurface(Z, o) {
    addProfile(o);
    const W = (l, u, y) => o.ax === 'z' ? [l, y, u] : [u, y, l];
    const col = o.col || BODY, T = Z.thin;
    let accum = 0;
    for (let i = 0; i < o.pts.length - 1; i++) {
        const a = o.pts[i], b = o.pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-6) continue;
        const nu = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
        const hint = o.ax === 'z' ? [0, ny, nu] : [nu, ny, 0];
        const v0 = accum / 4, v1 = (accum + len) / 4; accum += len;
        T.quad(W(o.l0, a[0], a[1]), W(o.l1, a[0], a[1]), W(o.l1, b[0], b[1]), W(o.l0, b[0], b[1]), col, { hint, uv: [[0, v0], [(o.l1 - o.l0) / 4, v0], [(o.l1 - o.l0) / 4, v1], [0, v1]] });
        const nc = o.neon || Z.hdr;
        [[o.l0 + .35, 1], [o.l1 - .35, -1]].forEach(([l]) => boxBetween(Z.neon, lift(W(l, a[0], a[1]), 0), lift(W(l, b[0], b[1]), 0), .3, .12, nc, { hint }));
        /* thin underside skirt for the side edges so the structure reads as solid */
        [o.l0, o.l1].forEach(l => {
            const pa = W(l, a[0], a[1]), pb = W(l, b[0], b[1]), pa2 = [pa[0] - hint[0] * .8, pa[1] - hint[1] * .8, pa[2] - hint[2] * .8], pb2 = [pb[0] - hint[0] * .8, pb[1] - hint[1] * .8, pb[2] - hint[2] * .8];
            T.quad(pa, pb, pb2, pa2, [.5, .5, .6], { tile: 4 });
        });
    }
}
/* one-turn (partial) spiral road with guard walls */
function spiral(Z, o) {
    const { cx, cz, r0, r1, H, a0, sweep } = o, gw = o.guard == null ? 1.7 : o.guard, wt = 1.4, TWO = Math.PI * 2;
    const tOf = (x, z) => { const dx = x - cx, dz = z - cz; let t = Math.atan2(dz, dx) - a0; t = ((t % TWO) + TWO) % TWO; return t; };
    addHeightRegion(cx - r1 - wt, cx + r1 + wt, cz - r1 - wt, cz + r1 + wt, (x, z) => {
        const r = Math.hypot(x - cx, z - cz);
        if (r < r0 - wt || r > r1 + wt) return 0;
        const t = tOf(x, z);
        if (t > sweep) return 0;
        const base = H * t / sweep;
        if (r >= r0 && r <= r1) return base;
        return gw > 0 ? base + gw : 0;
    });
    const N = Math.ceil(sweep / (Math.PI / 60)), S = Z.solid, col = o.col || BODY;
    const P = (r, t, y) => [cx + Math.cos(a0 + t) * r, y, cz + Math.sin(a0 + t) * r];
    const hAt = t => H * t / sweep;
    let acc = 0;
    for (let i = 0; i < N; i++) {
        const t0 = sweep * i / N, t1 = sweep * (i + 1) / N, y0 = hAt(t0), y1 = hAt(t1);
        const rm = (r0 + r1) / 2, seg = rm * (t1 - t0), v0 = acc / 4, v1 = (acc + seg) / 4; acc += seg;
        const uvs = [[0, v0], [(r1 - r0) / 4, v0], [(r1 - r0) / 4, v1], [0, v1]];
        S.quad(P(r0, t0, y0), P(r1, t0, y0), P(r1, t1, y1), P(r0, t1, y1), col, { uv: uvs, hint: [0, 1, 0] });
        const ins = [cx, 0, cz];
        /* outer + inner cliff faces */
        S.quad(P(r1 + wt, t0, y0 + gw), P(r1 + wt, t1, y1 + gw), P(r1 + wt, t1, 0), P(r1 + wt, t0, 0), col, { hint: [Math.cos(a0 + (t0 + t1) / 2), 0, Math.sin(a0 + (t0 + t1) / 2)], tile: 6 });
        S.quad(P(r0 - wt, t0, y0 + gw), P(r0 - wt, t1, y1 + gw), P(r0 - wt, t1, 0), P(r0 - wt, t0, 0), col, { hint: [-Math.cos(a0 + (t0 + t1) / 2), 0, -Math.sin(a0 + (t0 + t1) / 2)], tile: 6 });
        if (gw > 0) {
            /* guard wall inner faces + tops */
            S.quad(P(r1, t0, y0), P(r1, t1, y1), P(r1, t1, y1 + gw), P(r1, t0, y0 + gw), col, { hint: [-Math.cos(a0 + (t0 + t1) / 2), 0, -Math.sin(a0 + (t0 + t1) / 2)] });
            S.quad(P(r0, t0, y0), P(r0, t1, y1), P(r0, t1, y1 + gw), P(r0, t0, y0 + gw), col, { hint: [Math.cos(a0 + (t0 + t1) / 2), 0, Math.sin(a0 + (t0 + t1) / 2)] });
            S.quad(P(r1, t0, y0 + gw), P(r1 + wt, t0, y0 + gw), P(r1 + wt, t1, y1 + gw), P(r1, t1, y1 + gw), col, { hint: [0, 1, 0] });
            S.quad(P(r0 - wt, t0, y0 + gw), P(r0, t0, y0 + gw), P(r0, t1, y1 + gw), P(r0 - wt, t1, y1 + gw), col, { hint: [0, 1, 0] });
            boxBetween(Z.neon, P(r1 + .2, t0, y0 + gw + .1), P(r1 + .2, t1, y1 + gw + .1), .22, .14, o.neon || Z.hdr);
            boxBetween(Z.neon, P(r0 - .2, t0, y0 + gw + .1), P(r0 - .2, t1, y1 + gw + .1), .22, .14, o.neon || Z.hdr);
        }
        if (i % 3 === 0 && i < N - 2) {
            const tt0 = sweep * (i + .3) / N, tt1 = sweep * (i + 2.4) / N, rr = rm - 3.5, rr2 = rm + 3.5;
            Z.decal.quad(P(rr, tt0, hAt(tt0) + .05), P(rr2, tt0, hAt(tt0) + .05), P(rr2, tt1, hAt(tt1) + .05), P(rr, tt1, hAt(tt1) + .05), Z.soft, { uv: [[0, 0], [1, 0], [1, 1], [0, 1]], hint: [0, 1, 0] });
        }
    }
    /* end face */
    const te = sweep;
    S.quad(P(r0 - wt, te, H + gw), P(r1 + wt, te, H + gw), P(r1 + wt, te, 0), P(r0 - wt, te, 0), col, { hint: [-Math.sin(a0 + te), 0, Math.cos(a0 + te)], tile: 6 });
    S.quad(P(r0 - wt, 0, gw), P(r1 + wt, 0, gw), P(r1 + wt, 0, 0), P(r0 - wt, 0, 0), col, { hint: [Math.sin(a0), 0, -Math.cos(a0)], tile: 6 });
    return { start: P((r0 + r1) / 2, 0, 0), tAt: (t, r) => P(r == null ? (r0 + r1) / 2 : r, t, hAt(t)), H };
}
function roadStrip(x0, z0, x1, z1, w, y = .03) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), nx = -dz / len * w / 2, nz = dx / len * w / 2;
    const g = new THREE_NS.BufferGeometry();
    g.setAttribute('position', new THREE_NS.Float32BufferAttribute([x0 - nx, y, z0 - nz, x0 + nx, y, z0 + nz, x1 + nx, y, z1 + nz, x1 - nx, y, z1 - nz], 3));
    g.setAttribute('uv', new THREE_NS.Float32BufferAttribute([0, 0, 1, 0, 1, len / 16, 0, len / 16], 2));
    g.setAttribute('normal', new THREE_NS.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    const m = new THREE_NS.Mesh(g, roadMat);
    m.receiveShadow = true;
    scene.add(m);
    return m;
}

/* ---- glow sprites ---- */
const glowTex = (() => {
    const [c, x] = mkCanvas(128), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    /* smooth many-stop falloff: a 2-3 stop gradient bands hard once the GPU stretches it across a big sprite */
    for (let i = 0; i <= 16; i++) { const t = i / 16; g.addColorStop(t, `rgba(255,255,255,${(Math.pow(1 - t, 2.2)).toFixed(3)})`); }
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const tex = new THREE_NS.CanvasTexture(c); tex.colorSpace = THREE_NS.SRGBColorSpace;
    return tex;
})();
const lightTex = glowTex;
function glowSpriteAt(col, size, x, y, z, op, parent = scene) {
    const sp = new THREE_NS.Sprite(new THREE_NS.SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: op, blending: THREE_NS.AdditiveBlending, depthWrite: false, fog: false }));
    sp.scale.set(size, size, 1); sp.position.set(x, y, z); parent.add(sp);
    return sp;
}

/* ======================================================================
   THE PLAYGROUND
   ====================================================================== */
const orbSpawns = [], hoopSpawns = [], boostPads = [], smashSpawns = [], checkpoints = [], zoneRects = [], targetPads = [];
const PI = Math.PI;
const orbAt = (x, y, z) => orbSpawns.push([x, y, z]);
const orbGround = (x, z, off = 1.5) => orbSpawns.push([x, getSurfaceHeight(x, z) + off, z]);
const orbArc = (a, b, peak, n) => { for (let i = 0; i < n; i++) { const t = n === 1 ? .5 : i / (n - 1); orbSpawns.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + 4 * peak * t * (1 - t), a[2] + (b[2] - a[2]) * t]); } };
const hoopAt = (x, y, z, nrm, r = 5.2) => hoopSpawns.push({ x, y, z, nrm: nrm || [0, 0, 1], r });
const padAt = () => {}; /* no boost pads in the lab */
const checkpoint = (name, x, z, heading, y = 0) => checkpoints.push({ name, x, z, heading, y });
const zoneRect = (name, x0, x1, z0, z1, col) => zoneRects.push({ name, x0, x1, z0, z1, col: labHex(col) });
const crateBlock = (cx, cz, nx, ny, yaw = 0, col = 0, size = 1.5) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let k = 0; k < ny; k++) for (let i = 0; i < nx; i++) {
        const lx = (i - (nx - 1) / 2) * size, x = cx + lx * c, z = cz - lx * s;
        smashSpawns.push({ type: 'crate', x, y: getSurfaceHeight(x, z) + size / 2 + k * size, z, yaw, col, size });
    }
};
const crateTower = (cx, cz, base, yaw = 0, col = 0, size = 1.5) => {
    for (let k = 0; k < base; k++) {
        const n = base - k;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            const x = cx + (i - (n - 1) / 2) * size, z = cz + (j - (n - 1) / 2) * size;
            smashSpawns.push({ type: 'crate', x, y: getSurfaceHeight(x, z) + size / 2 + k * size, z, yaw, col, size });
        }
    }
};
const barrelTriangle = (cx, cz, rows, dir = 1, col = 0) => {
    for (let r = 0; r < rows; r++) for (let i = 0; i <= r; i++) {
        const x = cx + (i - r / 2) * 1.35, z = cz - dir * r * 1.2;
        smashSpawns.push({ type: 'barrel', x, y: getSurfaceHeight(x, z) + .6, z, yaw: 0, col, size: 1.2 });
    }
};
const barrelRow = (x0, z0, x1, z1, n, col = 0) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1), x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; smashSpawns.push({ type: 'barrel', x, y: getSurfaceHeight(x, z) + .6, z, yaw: 0, col, size: 1.2 }); } };

/* ---------------- ground ---------------- */
{
    const fl = new THREE_NS.Mesh(new THREE_NS.PlaneGeometry(2400, 2400), new THREE_NS.MeshStandardMaterial({ map: texFloor, roughness: .82, metalness: .12, envMapIntensity: .35 }));
    fl.rotation.x = -PI / 2;
    fl.receiveShadow = true;
    scene.add(fl);
}

/* signboards */
function signboard(text, x, y, z, yaw, color, w = 18, h = 4.5, Z) {
    const [c, g] = mkCanvas(1024, 256);
    color = labHex(color);
    g.fillStyle = '#03070d'; g.fillRect(0, 0, 1024, 256);
    g.strokeStyle = color; g.lineWidth = 5; g.strokeRect(14, 14, 996, 228);
    g.fillStyle = color; g.fillRect(14, 14, 60, 8); g.fillRect(950, 234, 60, 8); g.globalAlpha = .5; g.fillRect(30, 232, 24, 4); g.fillRect(60, 232, 8, 4); g.globalAlpha = 1;
    g.fillStyle = color; g.font = '600 118px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    { const mw = g.measureText(text).width; if (mw > 930) g.font = 'bold ' + Math.floor(118 * 930 / mw) + 'px "Helvetica Neue", Arial, sans-serif'; }
    g.shadowColor = color; g.shadowBlur = 28;
    g.fillText(text, 512, 138);
    const tex = new THREE_NS.CanvasTexture(c);
    tex.colorSpace = THREE_NS.SRGBColorSpace; tex.anisotropy = 8;
    const m = new THREE_NS.Mesh(new THREE_NS.PlaneGeometry(w, h), new THREE_NS.MeshBasicMaterial({ map: tex, color: new THREE_NS.Color(1.5, 1.5, 1.5), side: THREE_NS.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = yaw;
    scene.add(m);
    const m2 = m.clone(); m2.rotation.y = yaw + PI; m2.position.set(x - Math.sin(yaw) * .03, y, z - Math.cos(yaw) * .03); m.position.set(x + Math.sin(yaw) * .03, y, z + Math.cos(yaw) * .03); m2.material = m.material.clone(); m2.material.side = THREE_NS.FrontSide; m.material.side = THREE_NS.FrontSide; scene.add(m2);
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    [-1, 1].forEach(s => { const px = x + ca * s * (w / 2 - .6), pz = z - sa * s * (w / 2 - .6); aabb(Z.solid, px - .25, px + .25, 0, y - h / 2, pz - .25, pz + .25, BODY); });
}

/* ======================= TEST STRAIGHT + MAIN STREET ======================= */
const ZH = makeZone('TEST STRAIGHT', 0xff3d6e, [-30, 30, -100, 150]);
zoneRect('TEST STRAIGHT', -30, 30, -100, 175, '#ff3d6e');
roadStrip(0, -100, 0, 560, 22, .03);
roadStrip(-310, -85, 330, -85, 18, .036);
roadStrip(132, -85, 132, -50, 16, .042);
roadStrip(205, -85, 205, 10, 16, .042);
roadStrip(-60, -85, -60, 0, 14, .042);
roadStrip(60, -85, 60, -40, 14, .042);
roadStrip(-230, -85, -230, 46, 14, .042);
roadStrip(-85, 175, 0, 175, 12, .036);
roadStrip(-85, 175, -85, 192, 12, .042);
roadStrip(12, 274, 150, 274, 12, .036);
{
    /* neon edges + street lights */
    boxBetween(ZH.neon, [-11.1, .06, -100], [-11.1, .06, 560], .22, .06, [1.6, .3, .4]);
    boxBetween(ZH.neon, [11.1, .06, -100], [11.1, .06, 560], .22, .06, [1.9, .3, .5]);
    for (let z = -20; z <= 540; z += 24) [-12.6, 12.6].forEach(x => {
        aabb(ZH.solid, x - .14, x + .14, 0, 8, z - .14, z + .14, BODY);
        aabb(ZH.neon, x - .7, x + .7, 8, 8.25, z - .25, z + .25, [4, 4.4, 5]);
        /* removed: the flat billboarded glow disc here blew out and banded under bloom once real shadows were in */
    });
    /* start gate */
    [-14, 14].forEach(x => aabb(ZH.solid, x - .6, x + .6, 0, 10, -66.6, -65.4, BODY));
    aabb(ZH.solid, -14.6, 14.6, 10, 11.6, -66.6, -65.4, BODY);
    neonPath(ZH, [[-14.6, 10.05, -64.7], [14.6, 10.05, -64.7]], .5, .3, [4.2, .9, 1.2]);
    neonPath(ZH, [[-14.6, 11.7, -66], [14.6, 11.7, -66]], .35, .2, [4.2, .9, 1.2]);
    signboard('THRUST LAB // TEST RANGE 01', 0, 14.2, -66, 0, '#7fe6ff', 26, 4.6, ZH);
}
ramp(ZH, { x0: -6, x1: 6, z0: 120, z1: 135, h0: 0, h1: 4 });
[20, 70].forEach(z => padAt(0, z, 16, 9, [0, 1]));
orbGround(-5, 32); orbGround(5, 46); orbGround(-5, 74); orbGround(5, 88); orbGround(0, 112);
orbArc([0, 7, 138], [0, 5, 182], 6, 6);
hoopAt(0, 9, 158); hoopAt(0, 10, 182, [0, 0, 1]);
checkpoint('START', 0, -30, 0);

/* ======================= DROP TOWER (existing) ======================= */
const ZC = makeZone('DROP TOWER', 0x2cffa0, [46, 76, -90, 270]);
zoneRect('DROP TOWER', 44, 76, -90, 100, '#2cffa0');
ramp(ZC, { x0: 50, x1: 70, z0: -40, z1: 0, h0: 0, h1: 14 });
block(ZC, { x0: 50, x1: 70, z0: 0, z1: 100, h: 14 });
padAt(60, -62, 16, 9, [0, 1]);
const TG = [[160, 28, 'WIDE'], [205, 14, 'MEDIUM'], [250, 7, 'NARROW']];
TG.forEach(t => {
    const x0 = 60 - t[1] / 2, x1 = 60 + t[1] / 2, z0 = t[0] - 10, z1 = t[0] + 10, y = .05;
    const m = new THREE_NS.Mesh(new THREE_NS.PlaneGeometry(t[1], 20), new THREE_NS.MeshBasicMaterial({ color: new THREE_NS.Color(.04, .5, .24), transparent: true, opacity: .55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    m.rotation.x = -PI / 2; m.position.set(60, y, t[0]); scene.add(m);
    neonPath(ZC, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], .35, .08, [.6, 3, 1.6], true);
    neonPath(ZC, [[60 - t[1] / 4, y, t[0]], [60 + t[1] / 4, y, t[0]]], .25, .08, [.6, 3, 1.6]);
    orbAt(60, 1.5, t[0]);
    targetPads.push({ x: 60, z: t[0], w: t[1], name: t[2] });
});
for (let z = -30; z <= 90; z += 20) orbGround(60, z);
orbArc([60, 17, 102], [60, 3, 172], 7, 6);
hoopAt(60, 19, 118); hoopAt(60, 14, 145);
checkpoint('DROP TOWER', 60, -75, 0);

/* ======================= ADHESION LAB (existing profile) ======================= */
const ZW = makeZone('ADHESION LAB', 0xff3bd4, [-76, -44, -90, 40]);
zoneRect('ADHESION LAB', -78, -42, -90, 40, '#ff3bd4');
const wallRideConfig = { x0: -70, x1: -50, z0: 0, R: 24, Y: 51, topRadius: 12, throwAngle: 1.88 };
const wallRideProfile = [];
{
    const wallSamples = 40;
    for (let i = 0; i <= wallSamples; i++) {
        const a = -PI / 2 + (i / wallSamples) * PI / 2;
        wallRideProfile.push([wallRideConfig.z0 + wallRideConfig.R * Math.cos(a), wallRideConfig.R + wallRideConfig.R * Math.sin(a)]);
    }
    const crestStartY = wallRideConfig.Y - wallRideConfig.topRadius, wallTopZ = wallRideConfig.z0 + wallRideConfig.R;
    wallRideProfile.push([wallTopZ, crestStartY]);
    const crestSamples = 36, crestCenterZ = wallTopZ - wallRideConfig.topRadius;
    for (let i = 1; i <= crestSamples; i++) {
        const a = (i / crestSamples) * wallRideConfig.throwAngle;
        wallRideProfile.push([crestCenterZ + wallRideConfig.topRadius * Math.cos(a), crestStartY + wallRideConfig.topRadius * Math.sin(a)]);
    }
    profileSurface(ZW, { ax: 'z', l0: wallRideConfig.x0, l1: wallRideConfig.x1, pts: wallRideProfile, exact: true, col: BODY });
    /* chevrons up the face */
    for (let i = 0; i < wallRideProfile.length - 2; i += 6) {
        const a = wallRideProfile[i], b = wallRideProfile[Math.min(i + 5, wallRideProfile.length - 1)];
        if (a[1] > 40) break;
        const dz = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dz, dy), nz = -dy / l, ny = dz / l;
        const o = .06, P = (x, p) => [x, p[1] + ny * o, p[0] + nz * o];
        ZW.decal.quad(P(-66, a), P(-54, a), P(-54, b), P(-66, b), ZW.soft, { uv: [[0, 0], [1, 0], [1, 1], [0, 1]], hint: [0, ny, nz] });
    }
    padAt(-60, -45, 16, 9, [0, 1]);
    for (let i = 4; i < wallRideProfile.length; i += 7) {
        const pnt = wallRideProfile[i], nxt = wallRideProfile[Math.min(i + 1, wallRideProfile.length - 1)];
        const dz = nxt[0] - pnt[0], dy = nxt[1] - pnt[1], l = Math.hypot(dz, dy) || 1;
        orbAt(-60, pnt[1] + dz / l * 1.8, pnt[0] + (-dy / l) * 1.8);
    }
    orbAt(-60, 54, 12);
    hoopAt(-60, 44, 0, [0, 0, 1], 5);
}
checkpoint('ADHESION LAB', -60, -75, 0);

/* ======================= WALL-AERO TUNNEL (existing) ======================= */
const TUNNEL = { x: 30, y: 12.5, radius: 12.8, outerRadius: 13.45, z0: -46, z1: 78 };
{
    const ZT = makeZone('TUNNEL', 0x38c8ff, [14, 46, -50, 80]);
    zoneRect('AERO TUNNEL', 14, 46, -50, 80, '#38c8ff');
    const L = TUNNEL.z1 - TUNNEL.z0, cz = (TUNNEL.z0 + TUNNEL.z1) / 2;
    const shellGeometry = new THREE_NS.CylinderGeometry(TUNNEL.outerRadius, TUNNEL.outerRadius, L, 64, 1, true);
    shellGeometry.rotateX(PI / 2);
    const shell = new THREE_NS.Mesh(shellGeometry, new THREE_NS.MeshStandardMaterial({ color: 0x2c3556, roughness: .38, metalness: .68, side: THREE_NS.DoubleSide, envMapIntensity: 1.3 }));
    shell.position.set(TUNNEL.x, TUNNEL.y, cz); shell.castShadow = shell.receiveShadow = true; scene.add(shell);
    const ribMat = new THREE_NS.MeshStandardMaterial({ color: 0x45557a, roughness: .34, metalness: .78, emissive: 0x9c1a30, emissiveIntensity: 1.2 });
    for (let z = TUNNEL.z0 + 2; z < TUNNEL.z1; z += 11) {
        const rib = new THREE_NS.Mesh(new THREE_NS.TorusGeometry(TUNNEL.outerRadius - .12, .11, 8, 56), ribMat);
        rib.position.set(TUNNEL.x, TUNNEL.y, z); scene.add(rib);
    }
    const portalMat = new THREE_NS.MeshBasicMaterial({ color: new THREE_NS.Color(2.6, .4, .3) });
    [TUNNEL.z0, TUNNEL.z1].forEach(z => {
        const portal = new THREE_NS.Mesh(new THREE_NS.TorusGeometry(TUNNEL.outerRadius - .02, .26, 10, 72), portalMat);
        portal.position.set(TUNNEL.x, TUNNEL.y, z); scene.add(portal);
    });
    /* interior light bars along the ceiling and glowing lane lines */
    for (let z = TUNNEL.z0 + 5; z < TUNNEL.z1 - 3; z += 12) {
        for (let k = 0; k < 6; k++) {
            const a = PI / 2 + (k - 2.5) * .62, r = TUNNEL.radius - .35;
            aabb(ZT.neon, TUNNEL.x + Math.cos(a) * r - .5, TUNNEL.x + Math.cos(a) * r + .5, TUNNEL.y + Math.sin(a) * r - .06, TUNNEL.y + Math.sin(a) * r + .06, z - 1.1, z + 1.1, [.5, 1.9, 3.2]);
        }
    }
    [-.85, .85].forEach(ox => boxBetween(ZT.neon, [TUNNEL.x + ox, .05, TUNNEL.z0], [TUNNEL.x + ox, .05, TUNNEL.z1], .12, .04, [.4, 1.4, 2.4]));
    for (let z = -40; z <= 70; z += 8) { const a = z * .13; orbAt(TUNNEL.x + Math.cos(a) * (TUNNEL.radius - 1.6), TUNNEL.y + Math.sin(a) * (TUNNEL.radius - 1.6) * .98, z); }
    padAt(30, -66, 16, 9, [0, 1]);
    checkpoint('AERO TUNNEL', 30, -62, 0);
    glowSpriteAt(new THREE_NS.Color(1.4, .3, .2), 9, TUNNEL.x, TUNNEL.y, TUNNEL.z0 - 1, .22);
}

/* ======================= CLEARANCE RANGE (north along Main Street) ======================= */
const ZJ = makeZone('CLEARANCE RANGE', 0xffb02e, [-12, 12, 175, 420]);
zoneRect('CLEARANCE RANGE', -14, 14, 178, 420, '#ffb02e');
[[185, 200, 206, 221, 5], [255, 272, 280, 297, 7], [350, 372, 380, 402, 10]].forEach(([a, b, c, d, h], idx) => {
    ramp(ZJ, { x0: -8, x1: 8, z0: a, z1: b, h0: 0, h1: h });
    block(ZJ, { x0: -8, x1: 8, z0: b, z1: c, h });
    ramp(ZJ, { x0: -8, x1: 8, z0: c, z1: d, h0: h, h1: 0, chev: false });
    padAt(0, a - 18, 14, 9, [0, 1]);
    orbArc([0, h + 3, b], [0, 2, d + 30 + idx * 14], 6 + idx * 2, 6);
    hoopAt(0, h + 7 + idx * 2, (b + d) / 2 + 10 + idx * 6, [0, 0, 1], 5.6);
});
signboard('CLEARANCE RANGE', 0, 11, 168, 0, '#ffb02e', 20, 4.6, ZJ);
checkpoint('CLEARANCE RANGE', 0, 172, 0);

/* ======================= KINEMATICS YARD (east) ======================= */
const ZS = makeZone('KINEMATICS YARD', 0xa66bff, [110, 330, -70, 180]);
zoneRect('KINEMATICS YARD', 108, 330, -62, 185, '#a66bff');
{
    /* vert ramp: quarter pipe, runs vertical at the top */
    const z0 = -60, R = 15, pts = [];
    for (let i = 0; i <= 28; i++) { const a = -PI / 2 + (i / 28) * PI / 2; pts.push([z0 + R * Math.cos(a), R + R * Math.sin(a)]); }
    pts.push([z0 + R, R + 4]);
    profileSurface(ZS, { ax: 'z', l0: 122, l1: 142, pts, clip: true, col: BODY });
    padAt(132, -78, 16, 9, [0, 1]);
    orbAt(132, 6, -50); orbAt(132, 14, -45); orbAt(132, 22, -44.5); orbAt(132, 30, -44.5);
    hoopAt(132, 26, -44, [0, 1, 0], 4.6);
    signboard('VERTICAL RIG', 132, 7.5, -86, 0, '#a66bff', 14, 3.6, ZS);
    checkpoint('KINEMATICS YARD', 132, -72, 0);
    /* half pipe */
    const cxp = 205, fl = 7, Rp = 11, right = [], left = [];
    for (let i = 0; i <= 24; i++) { const th = (i / 24) * PI / 2; right.push([cxp + fl + Rp * Math.sin(th), Rp - Rp * Math.cos(th)]); }
    for (let i = 0; i <= 24; i++) { const th = PI / 2 - (i / 24) * PI / 2; left.push([cxp - fl - Rp * Math.sin(th), Rp - Rp * Math.cos(th)]); }
    profileSurface(ZS, { ax: 'x', l0: 10, l1: 80, pts: right, clip: true, col: BODY });
    profileSurface(ZS, { ax: 'x', l0: 10, l1: 80, pts: left, clip: true, col: BODY });
    /* floor of the pipe: a lit slab */
    boxBetween(ZS.neon, [cxp - 3, .06, 10], [cxp - 3, .06, 80], .2, .05, ZS.hdr);
    boxBetween(ZS.neon, [cxp + 3, .06, 10], [cxp + 3, .06, 80], .2, .05, ZS.hdr);
    block(ZS, { x0: cxp + fl + Rp, x1: cxp + fl + Rp + 17, z0: 10, z1: 80, h: Rp });
    block(ZS, { x0: cxp - fl - Rp - 17, x1: cxp - fl - Rp, z0: 10, z1: 80, h: Rp });
    ramp(ZS, { x0: cxp + fl + Rp + 17, x1: cxp + fl + Rp + 47, z0: 10, z1: 80, h0: Rp, h1: 0, axis: 'x', chev: false });
    ramp(ZS, { x0: cxp - fl - Rp - 47, x1: cxp - fl - Rp - 17, z0: 10, z1: 80, h0: 0, h1: Rp, axis: 'x' });
    for (let z = 22; z <= 70; z += 12) { orbAt(cxp, 1.5, z); orbAt(cxp - fl - 6, 5.5 + (z % 24 ? 1 : 0), z + 3); orbAt(cxp + fl + 6, 5.5 + (z % 24 ? 0 : 1), z + 3); }
    hoopAt(cxp, 14, 34, [0, 0, 1], 6.5); hoopAt(cxp, 14, 62, [0, 0, 1], 6.5);
    signboard('CURVATURE RIG', 205, 7.5, -3, 0, '#a66bff', 14, 3.6, ZS);
    /* funbox pyramids */
    hip(ZS, { cx: 290, cz: -30, hx: 13, hz: 13, H: 6, slope: .75 });
    hip(ZS, { cx: 290, cz: 10, hx: 15, hz: 15, H: 8, slope: .8 });
    hip(ZS, { cx: 290, cz: 56, hx: 17, hz: 17, H: 10, slope: .8 });
    hip(ZS, { cx: 255, cz: 118, hx: 12, hz: 28, H: 5, slope: .6 });
    orbAt(290, 8.5, -30); orbAt(290, 11, 10); orbAt(290, 13.5, 56);
    orbArc([270, 4, 100], [292, 8, 118], 4, 4);
    /* stepped kickers into a gap: Stunt Park mainline */
    ramp(ZS, { x0: 126, x1: 146, z0: 58, z1: 72, h0: 0, h1: 3 });
    ramp(ZS, { x0: 126, x1: 146, z0: 100, z1: 116, h0: 0, h1: 5 });
    block(ZS, { x0: 126, x1: 146, z0: 116, z1: 122, h: 5 });
    ramp(ZS, { x0: 126, x1: 146, z0: 122, z1: 138, h0: 5, h1: 0, chev: false });
    orbArc([136, 6, 118], [136, 2, 160], 6, 5);
    /* crate pyramid + bowling */
    crateTower(160, 150, 6, 0, 1);
    barrelTriangle(192, 160, 5, -1, 0);
    crateBlock(176, 120, 8, 3, 0, 2);
}

/* ======================= GRAVITY WELL ======================= */
const ZB = makeZone('GRAVITY WELL', 0xff7a3d, [-310, -150, 40, 200]);
zoneRect('GRAVITY WELL', -304, -156, 46, 194, '#ff7a3d');
{
    const cx = -230, cz = 120, r0 = 22, r1 = 48, r2 = 56, r3 = 74, H = 11;
    const bowl = (x, z) => { const r = Math.hypot(x - cx, z - cz); return r < r0 ? 0 : r < r1 ? H * Math.pow((r - r0) / (r1 - r0), 2) : r < r2 ? H : r < r3 ? H * (1 - (r - r2) / (r3 - r2)) : 0; };
    addHeightRegion(cx - r3, cx + r3, cz - r3, cz + r3, bowl);
    terrainMesh({ x0: cx - r3, x1: cx + r3, z0: cz - r3, z1: cz + r3, step: 2, f: bowl, tint: [1.2, .7, .55], H, tile: 32 });
    const ring = (r, y, col, n = 72) => { const pts = []; for (let i = 0; i < n; i++) { const a = i / n * PI * 2; pts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]); } neonPath(ZB, pts, .4, .1, col, true); };
    ring(r1 + .3, H + .08, ZB.hdr); ring(r2 - .3, H + .08, ZB.hdr); ring(r0 + .2, .08, [1.2, .6, .3]);
    for (let r = 30; r < r1; r += 9) ring(r, bowl(cx + r, cz) + .06, [1.0, .45, .2], 90);
    const isl = (x, z) => { const d = Math.hypot(x - cx, z - cz); return d < 12 ? 4.6 * (.5 + .5 * Math.cos(PI * d / 12)) : 0; };
    addHeightRegion(cx - 12, cx + 12, cz - 12, cz + 12, isl);
    terrainMesh({ x0: cx - 12, x1: cx + 12, z0: cz - 12, z1: cz + 12, step: 1, f: isl, tint: [1.2, .8, .6], H: 4.6, tile: 32 });
    for (let i = 0; i < 12; i++) { const a = i / 12 * PI * 2, r = 36; orbGround(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 1.7); }
    for (let i = 0; i < 6; i++) { const a = i / 6 * PI * 2 + .3, r = 52; orbGround(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 1.7); }
    orbAt(cx, 8.5, cz);
    hoopAt(cx, 12, cz + 27, [1, 0, 0], 6);
    barrelRow(cx - 14, cz + 18, cx + 14, cz + 18, 6, 1);
    signboard('GRAVITY WELL', -230, 8, 36, 0, '#ff7a3d', 14, 3.6, ZB);
    checkpoint('GRAVITY WELL', -230, 30, 0);
}

/* ======================= COLLISION LAB ======================= */
const ZG = makeZone('COLLISION LAB', 0xc6ff3d, [-150, -30, 185, 430]);
zoneRect('COLLISION LAB', -150, -28, 188, 430, '#c6ff3d');
{
    for (let i = 0; i < 8; i++) for (let k = 0; k < 5; k++) {
        const x = -128 + 20 * k + (i % 2) * 10, z = 208 + i * 8.5;
        pillar(ZG, { cx: x, cz: z, r: 1.6, h: 5.5 });
        if ((i + k) % 3 === 0 && k < 4) orbGround(x + 10, z + 4.5, 1.6);
    }
    [[-135, -80, 276], [-100, -45, 292], [-135, -80, 308]].forEach(([a, b, z]) => block(ZG, { x0: a, x1: b, z0: z, z1: z + 2.4, h: 3.6 }));
    orbGround(-70, 277); orbGround(-110, 293); orbGround(-70, 309);
    /* barrier hops */
    [330, 352, 374].forEach((z, i) => {
        block(ZG, { x0: -120, x1: -60, z0: z, z1: z + 2.2, h: 2.4 });
        ramp(ZG, { x0: -100, x1: -80, z0: z - 15, z1: z - 3, h0: 0, h1: 3.4 });
        orbArc([-90, 6.5, z - 2], [-90, 2.5, z + 12], 3.4, 3);
    });
    crateBlock(-85, 400, 14, 5, 0, 0);
    crateTower(-120, 414, 6, 0, 2); crateTower(-55, 414, 6, 0, 1);
    barrelRow(-130, 425, -40, 425, 12, 2);
    hoopAt(-90, 8, 340, [0, 0, 1], 5.4);
    signboard('COLLISION LAB', -85, 10, 182, 0, '#c6ff3d', 24, 4.6, ZG);
    checkpoint('COLLISION LAB', -85, 186, 0);
}

/* ======================= DUNES ======================= */
const ZD = makeZone('TERRAIN SIM', 0xff5a8a, [-330, -150, -270, -100]);
zoneRect('TERRAIN SIM', -330, -150, -272, -98, '#ff5a8a');
{
    const x0 = -330, x1 = -150, z0 = -272, z1 = -102, sm = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    const dunes = (x, z) => {
        const e = Math.min(x - x0, x1 - x, z - z0, z1 - z), win = sm(0, 22, e);
        const w1 = Math.sin(z * .072 + Math.sin(x * .021) * 2.2), w2 = Math.sin(x * .052 + z * .031 + 1.3);
        return win * (4.6 * Math.pow(.5 + .5 * w1, 1.35) + 2.6 * Math.pow(.5 + .5 * w2, 1.6));
    };
    addHeightRegion(x0, x1, z0, z1, dunes);
    terrainMesh({ x0, x1, z0, z1, step: 2.5, f: dunes, tint: [1.2, .55, .75], H: 7, tile: 32 });
    for (let i = 0; i < 16; i++) { const x = -310 + ((i * 53) % 150), z = -250 + ((i * 97) % 140); orbGround(x, z, 1.9); }
    barrelRow(-250, -112, -210, -112, 6, 2);
    crateBlock(-200, -180, 6, 3, .4, 1);
    signboard('TERRAIN SIM', -230, 8, -90, 0, '#ff5a8a', 12, 3.6, ZD);
    checkpoint('TERRAIN SIM', -230, -100, 0);
}

/* ======================= ASCENT HELIX ======================= */
const ZP = makeZone('ASCENT HELIX', 0x3dffd9, [100, 200, 250, 350]);
zoneRect('ASCENT HELIX', 106, 196, 254, 346, '#3dffd9');
{
    const sp = spiral(ZP, { cx: 150, cz: 300, r0: 18, r1: 34, H: 30, a0: -PI / 2, sweep: 5.236 });
    pillar(ZP, { cx: 150, cz: 300, r: 5, h: 46 });
    for (let t = .5; t < 5.2; t += .5) { const q = sp.tAt(t); orbAt(q[0], q[1] + 1.6, q[2]); }
    const e = sp.tAt(5.236);
    orbArc([e[0], e[1] + 4, e[2]], [e[0] + 25, 4, e[2] - 70], 14, 6);
    hoopAt(e[0] + 7, e[1] + 1.5, e[2] - 12, [.5, 0, -.87], 6);
    signboard('ASCENT HELIX', 100, 8, 262, 0, '#3dffd9', 20, 4.4, ZP);
    checkpoint('ASCENT HELIX', 112, 274, PI / 2);
}

/* ======================= ORBITAL RAMP + TOWERS ======================= */
const ZK = makeZone('ORBITAL RAMP', 0xff3b5c, [-60, 60, 425, 760]);
zoneRect('ORBITAL RAMP', -60, 60, 425, 800, '#ff3b5c');
{
    ramp(ZK, { x0: -14, x1: 14, z0: 440, z1: 515, h0: 0, h1: 30 });
    padAt(0, 430, 16, 10, [0, 1], 1.4);
    [[0, 590, 8, 24], [0, 655, 8, 18], [-48, 695, 10, 12], [44, 705, 10, 15], [0, 735, 12, 8]].forEach(([x, z, r, h], i) => {
        pillar(ZK, { cx: x, cz: z, r, h });
        orbAt(x, h + 2, z);
    });
    orbArc([0, 33, 516], [0, 26, 585], 8, 8);
    hoopAt(0, 38, 540, [0, 0, 1], 7); hoopAt(0, 34, 565, [0, 0, 1], 7); hoopAt(0, 30, 625, [0, 0, 1], 7); hoopAt(0, 24, 690, [0, 0, 1], 7);
    targetPads.push({ x: 0, z: 795, w: 56, name: 'PRECISION', round: true, r: 28 });
    {
        const pts = []; for (let i = 0; i < 64; i++) { const a = i / 64 * PI * 2; pts.push([Math.cos(a) * 28, .06, 795 + Math.sin(a) * 28]); }
        neonPath(ZK, pts, .5, .1, [3, .8, 1.1], true);
        const pts2 = []; for (let i = 0; i < 48; i++) { const a = i / 48 * PI * 2; pts2.push([Math.cos(a) * 14, .06, 795 + Math.sin(a) * 14]); }
        neonPath(ZK, pts2, .4, .1, [3, .8, 1.1], true);
    }
    signboard('ORBITAL RAMP', 0, 14, 425, 0, '#ff3b5c', 22, 4.8, ZK);
    checkpoint('ORBITAL RAMP', 0, 428, 0);
}

finalizeZones();

/* zone label lookup */
function zoneAt(x, z) {
    for (let i = zoneRects.length - 1; i >= 0; i--) { const r = zoneRects[i]; if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return r; }
    return null;
}

const paint = new THREE_NS.MeshPhysicalMaterial({
    color: 0xe7ebf2,
    vertexColors: true,
    roughness: .27,
    metalness: .58,
    clearcoat: 1, envMapIntensity: 1.7,
    clearcoatRoughness: 0.16,
    side: THREE_NS.DoubleSide
}), plain = new THREE_NS.MeshPhysicalMaterial({
    color: 0xd7deea,
    roughness: .24,
    metalness: .62,
    clearcoat: 0.88,
    clearcoatRoughness: 0.18
}), glass = new THREE_NS.MeshPhysicalMaterial({
    color: 0x080c14,
    envMapIntensity: 2.4,
    roughness: .09,
    metalness: .42,
    clearcoat: 1,
    clearcoatRoughness: .08,
    side: THREE_NS.DoubleSide
}), carbon = new THREE_NS.MeshStandardMaterial({
    color: 0x080b11,
    roughness: .3,
    metalness: .62
}), bronze = new THREE_NS.MeshStandardMaterial({
    color: 0xb5762f,
    roughness: .3,
    metalness: 1,
    emissive: 0x2a1005
}), redLed = new THREE_NS.MeshBasicMaterial({
    color: new THREE_NS.Color(0xff1a1a).multiplyScalar(1.8)
}), whiteLed = new THREE_NS.MeshBasicMaterial({
    color: new THREE_NS.Color(0xffffff).multiplyScalar(2)
});
/* ---------- hard-surface faceted body: straight-line loft between stations, flat (non-averaged)
   per-triangle normals throughout, so every panel break reads as a crisp crease instead of a
   smoothed fillet. This replaces the old Catmull-Rom-smoothed, normal-averaged lofted body. ---------- */
function buildFlatLoft(stations, opts = {}) {
    const rings = stations.map(st => {
        const half = st.pts;
        const full = half.concat(half.slice(1, -1).reverse().map(pt => [-pt[0], pt[1]]));
        return full.map(pt => [pt[0], pt[1], st.z]);
    });
    const ringSize = rings[0].length;
    let minY = Infinity, maxY = -Infinity;
    rings.forEach(ring => ring.forEach(pt => { minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1]); }));
    const spanY = Math.max(1e-4, maxY - minY);
    const shadeOf = y => opts.flatShade ? 1 : (.42 + .58 * (y - minY) / spanY);
    const positions = [], colors = [];
    const pushTri = (a, b, c) => {
        [a, b, c].forEach(v => positions.push(v[0], v[1], v[2]));
        [a, b, c].forEach(v => { const s = shadeOf(v[1]); colors.push(s, s, s); });
    };
    for (let row = 0; row < rings.length - 1; row++) {
        for (let col = 0; col < ringSize; col++) {
            const a = rings[row][col], b = rings[row][(col + 1) % ringSize];
            const c = rings[row + 1][(col + 1) % ringSize], d = rings[row + 1][col];
            pushTri(a, b, c);
            pushTri(a, c, d);
        }
    }
    [0, rings.length - 1].forEach(ri => {
        const ring = rings[ri];
        const center = ring.reduce((s, pt) => [s[0] + pt[0] / ringSize, s[1] + pt[1] / ringSize, s[2] + pt[2] / ringSize], [0, 0, 0]);
        for (let col = 0; col < ringSize; col++) {
            const a = ring[col], b = ring[(col + 1) % ringSize];
            if (ri === 0) pushTri(center, b, a); else pushTri(center, a, b);
        }
    });
    const geometry = new THREE_NS.BufferGeometry();
    geometry.setAttribute('position', new THREE_NS.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE_NS.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
}
/* body panel cross-section: floor -> sill step -> rocker crease -> straight door flank -> shoulder lip -> center top */
const panelSection = (z, w, floorY, lowY, beltY, sill = .86, lip = .82) => ({
    z, pts: [[0, floorY], [w * sill, floorY], [w, lowY], [w, beltY], [w * lip, beltY + .055], [0, beltY + .075]]
});
/* glasshouse cross-section: base -> roof, kept to 4 flat points so each gap between stations is one flat pane */
const cabinSection = (z, b, r, bw, rw) => ({ z, pts: [[0, b], [bw, b], [rw, r], [0, r + .01]] });
const rig = new THREE_NS.Group(), car = new THREE_NS.Group();
car.position.y = -.5;
rig.add(car);
scene.add(rig);
window.__car = car; window.__rig = rig;
const addBoxMesh = (w, h, d, m, x, y, z, p = car) => {
    const o = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    p.add(o);
    return o;
};
/* cold-gas thruster array: graphite bell housings with a cool plasma-white core,
   seated in the Tesla Roadster model's own rear outlet bores */
const nozHouse = new THREE_NS.MeshStandardMaterial({ color: 0x0a0e15, roughness: .22, metalness: .95, envMapIntensity: 1.4 });
const nozGlow = new THREE_NS.MeshBasicMaterial({ color: new THREE_NS.Color(1.0, 2.6, 3.6), side: THREE_NS.DoubleSide });
const nozRing = new THREE_NS.MeshBasicMaterial({ color: new THREE_NS.Color(.35, .9, 1.4), side: THREE_NS.DoubleSide });
const NOZZLE_X = [-.393, -.131, .131, .393], NOZZLE_Y = .524, NOZZLE_Z = -2.1235;
NOZZLE_X.forEach(x => {
    const h = new THREE_NS.Mesh(new THREE_NS.CylinderGeometry(.06, .088, .11, 28, 1, true), nozHouse);
    h.material.side = THREE_NS.DoubleSide;
    h.rotation.x = -Math.PI / 2; h.position.set(x, NOZZLE_Y, NOZZLE_Z - .05); car.add(h);
    const ring = new THREE_NS.Mesh(new THREE_NS.RingGeometry(.083, .093, 28), nozRing);
    ring.rotation.y = Math.PI; ring.position.set(x, NOZZLE_Y, NOZZLE_Z - .1); car.add(ring);
    const core = new THREE_NS.Mesh(new THREE_NS.CircleGeometry(.062, 24), nozGlow);
    core.rotation.y = Math.PI; core.position.set(x, NOZZLE_Y, NOZZLE_Z + .015); car.add(core);
});

/* ---------- Tesla Roadster body: a hand-authored GLB (tesla_roadster.glb) replaces the old
   procedural body/cabin/wheels/wing/aero-trim entirely. The GLB already models the paint
   shell, glazing, aero trim, diffuser, wing and all four wheels (with brake rotors, calipers
   and alloy spokes) as named node groups, so loading it is the whole job; wheel spin/steer,
   the wing deploy animation and brake-light color are wired to those named nodes once it loads. */
let WV = [];
let wing = null, wingBaseY = 1.07;
new GLTFLoader().load('tesla_roadster.glb', gltf => {
    const model = gltf.scene;
    model.position.set(0, 0, 0);
    car.add(model);
    const byName = name => model.getObjectByName(name);
    [['Front_Left_Wheel_Group', 1], ['Front_Right_Wheel_Group', 1], ['Rear_Left_Wheel_Group', 0], ['Rear_Right_Wheel_Group', 0]].forEach(([name, fr]) => {
        const g = byName(name);
        if (g) { g.rotation.order = 'YXZ'; WV.push([g, fr]); }
    });
    const wingNode = byName('Raised_Rear_Wing_Group');
    if (wingNode) { wingBaseY = wingNode.position.y; wing = wingNode; }
    ['Unbroken upper red LED tail ribbon', 'Lower fine red LED tail ribbon', 'Full-width dark red tail lens'].forEach(name => {
        const m = byName(name);
        if (m && m.isMesh) m.material = tailMat;
    });
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    loadScreen.modelReady = true;
    loadScreen.set(.8, 'Compiling shaders');
    loadScreen.check();
}, xhr => {
    if (xhr.lengthComputable) loadScreen.set(.2 + .6 * xhr.loaded / xhr.total, 'Loading Roadster');
}, err => {
    console.error('tesla_roadster.glb failed to load', err);
    loadScreen.modelReady = true;
    loadScreen.check();
});

const glowSprite = (col, size, x, y, z, op) => glowSpriteAt(col, size, x, y, z, op, car);

/* ---------- lighting: the model's headlamp/taillamp lenses are already properly shaped and
   emissive (baked KHR_materials_emissive_strength materials), so only bloom-boosting glow
   sprites and the actual illuminating lights are added here, positioned at the GLB's own
   lamp coordinates. tailMat (swapped onto the model's tail-lens meshes above) is the one
   piece of lamp material driven dynamically, for brake-light brightening. ---------- */
const tailMat = new THREE_NS.MeshBasicMaterial({ color: new THREE_NS.Color(2.2, .04, .08) });
const revMat = new THREE_NS.MeshBasicMaterial({ color: new THREE_NS.Color(0, 0, 0) });
const tailSprites = [];
[-1, 1].forEach(s => {
    const a = glowSprite(new THREE_NS.Color(1, .08, .1), .85, s * .66, .85, -2.26, .5); a.userData.o = .5; a.userData.sx = .85; tailSprites.push(a);
});
const tailBarSprite = glowSprite(new THREE_NS.Color(1, .08, .1), 1, 0, .85, -2.28, .26); tailBarSprite.scale.set(1.8, .3, 1); tailBarSprite.userData.o = .26; tailBarSprite.userData.sx = 1.8; tailBarSprite.userData.sy = .3; tailSprites.push(tailBarSprite);
[-1, 1].forEach(s => {
    glowSprite(new THREE_NS.Color(.75, .85, 1.2), .5, s * .8, .65, 2.05, .5).scale.set(1, .75, 1);
});
const glow = new LegacyPointLight(0xc7dcff, 0, 16);
glow.position.set(0, .5, -2.7);
const underGlow = new LegacyPointLight(0x7a5cff, .9, 7);
underGlow.position.set(0, -.28, 0);
const rearRim = new LegacyPointLight(0xff2539, .45, 7);
rearRim.position.set(0, .55, -2.5);
rig.add(glow, underGlow, rearRim);
/* real light: two projector spots + a wide fill so the road ahead is genuinely lit */
const headSpots = [];
[-1, 1].forEach(s => {
    const sl = new LegacySpotLight(0xdbe8ff, 5.5, 110, .36, .85, 1.35);
    sl.position.set(s * .8, .62, 2.1);
    sl.target.position.set(s * .4, -.1, 22);
    rig.add(sl, sl.target);
    headSpots.push(sl);
});
const hl2 = new LegacySpotLight(0xcfe0ff, 2.2, 40, .95, 1, 1.5);
hl2.position.set(0, .62, 2.1);
hl2.target.position.set(0, -.1, 9);
rig.add(hl2, hl2.target);
/* a faint, narrow beam so the headlights read in the dusk haze (no giant cones) */
const beamMat = new THREE_NS.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE_NS.AdditiveBlending, side: THREE_NS.DoubleSide, fog: false });
{
    const vT = positionLocal.z.div(24);
    const f = pow(abs(dot(normalView, positionView.negate().normalize())), 2.4);
    const a = f.mul(pow(tslClamp(vT.oneMinus(), 0, 1), 2)).mul(smoothstep(0, .05, vT)).mul(.075);
    beamMat.fragmentNode = vec4(vec3(.66, .78, 1).mul(a), 1);
}
[-1, 1].forEach(s => {
    const g = new THREE_NS.CylinderGeometry(1.35, .05, 24, 24, 1, true);
    g.rotateX(PI / 2);
    g.translate(0, 0, 12);
    const m = new THREE_NS.Mesh(g, beamMat);
    m.position.set(s * .8, .65, 2.2);
    m.renderOrder = 3;
    car.add(m);
});
let _lastBrake = -1;
function updateCarLights(brake, rev) {
    const k = 1 + brake * 2.2;
    tailMat.color.setRGB(2.2 * k, .04 + brake * .35, .08 + brake * .3);
    revMat.color.setScalar(rev ? 3.2 : 0);
    tailSprites.forEach(s => {
        s.material.opacity = Math.min(1, s.userData.o * (1 + brake * 1.6));
        const sc = 1 + brake * .55;
        s.scale.set(s.userData.sx * sc, (s.userData.sy || s.userData.sx) * sc, 1);
    });
    rearRim.intensity = .45 + brake * 1.9;
}

car.traverse(o => { if (o.isMesh && !o.userData.noShadow) o.castShadow = true; });

/* removed: fake "contact shadow" blob mesh under the car. It doubled up with the real shadow map
   (now rendered properly with WebGPU) and read as a blocky dark patch under the wheels. */
const contactBlob = { material: { opacity: 0 } };

/* ---------- particles: thruster plume + landing dust ---------- */
const PARTICLE_COUNT = 7200, particlePositions = new Float32Array(PARTICLE_COUNT * 3), particleColors = new Float32Array(PARTICLE_COUNT * 3), particleVelocities = new Float32Array(PARTICLE_COUNT * 3), particleLifetimes = new Float32Array(PARTICLE_COUNT).fill(1), particleAges = new Float32Array(PARTICLE_COUNT).fill(1), particleKinds = new Uint8Array(PARTICLE_COUNT);
const particleSizes = new Float32Array(PARTICLE_COUNT), particleAlphas = new Float32Array(PARTICLE_COUNT), particleRots = new Float32Array(PARTICLE_COUNT), particleRotSeed = new Float32Array(PARTICLE_COUNT), particleBase = new Float32Array(PARTICLE_COUNT).fill(1);
const particleVariant = new Float32Array(PARTICLE_COUNT);
let nextParticleIndex = 0;
const particleScale = uniform(600);
{
    /* per-particle data lives in instanced attributes; each particle is a camera-facing quad */
    const attr = (arr, n) => new THREE_NS.InstancedBufferAttribute(arr, n).setUsage(THREE_NS.DynamicDrawUsage);
    const g = { attributes: { position: attr(particlePositions, 3), color: attr(particleColors, 3), aSize: attr(particleSizes, 1), aAlpha: attr(particleAlphas, 1), aRot: attr(particleRots, 1), aVar: attr(particleVariant, 1) } };
    /* 2x2 PNG sprite atlas (smoke.png): four pre-rendered wispy smoke puffs (fractal-noise
       alpha masks baked to a texture), used for flame/spark/dust (quadrant 0) and smoke
       (quadrants 0-3) so puffs read as real volumetric smoke instead of flat drawn circles */
    const smokeTex = new THREE_NS.TextureLoader().load('smoke.png');
    smokeTex.generateMipmaps = false;
    smokeTex.minFilter = THREE_NS.LinearFilter;
    smokeTex.magFilter = THREE_NS.LinearFilter;
    smokeTex.wrapS = smokeTex.wrapT = THREE_NS.ClampToEdgeWrapping;
    const A = g.attributes, mat = new THREE_NS.PointsNodeMaterial({
        transparent: true, depthWrite: false, fog: false, sizeAttenuation: false,
        blending: THREE_NS.CustomBlending, blendEquation: THREE_NS.AddEquation,
        blendSrc: THREE_NS.OneFactor, blendDst: THREE_NS.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE_NS.OneFactor, blendDstAlpha: THREE_NS.OneMinusSrcAlphaFactor
    });
    mat.positionNode = instancedBufferAttribute(A.position);
    mat.rotationNode = instancedBufferAttribute(A.aRot);
    /* same size rule as the old gl_PointSize: world size, capped at 360 device pixels */
    mat.sizeNode = min(instancedBufferAttribute(A.aSize).mul(particleScale).div(max(modelViewMatrix.mul(vec4(mat.positionNode, 1)).z.negate(), .1)), 360).div(screenDPR);
    const varCol = instancedBufferAttribute(A.aVar).mod(2), varRow = instancedBufferAttribute(A.aVar).div(2).floor();
    const atlasUv = uv().mul(.5).add(vec2(varCol, varRow).mul(.5));
    const tA = texture(smokeTex, atlasUv).a;
    mat.fragmentNode = vec4(instancedBufferAttribute(A.color).mul(tA), instancedBufferAttribute(A.aAlpha).mul(tA));
    window.particleMaterial = mat;
    const p = new THREE_NS.Sprite(mat);
    p.count = PARTICLE_COUNT;
    p.frustumCulled = false;
    p.renderOrder = 5;
    scene.add(p);
    window.pg = g;
}
const emitParticle = (p, v, l, k, sz = 1, variant = 0) => {
    const i = nextParticleIndex++ % PARTICLE_COUNT, o = i * 3;
    particlePositions[o] = p.x;
    particlePositions[o + 1] = p.y;
    particlePositions[o + 2] = p.z;
    particleVelocities[o] = v.x;
    particleVelocities[o + 1] = v.y;
    particleVelocities[o + 2] = v.z;
    particleLifetimes[i] = l;
    particleAges[i] = 0;
    particleKinds[i] = k;
    particleBase[i] = sz;
    particleRotSeed[i] = Math.random() * 6.283;
    particleVariant[i] = variant;
};
const randomOffset = s => (Math.random() - .5) * s;

/* ---------- rigid-body vehicle ---------- */
const VEHICLE_MASS = 1500, VEHICLE_INERTIA = [2600, 2800, 700], LEN = .55, WHEEL_CONTACT_OFFSETS = [[.9, 1.45, 1], [-.9, 1.45, 1], [.98, -1.35, 0], [-.98, -1.35, 0]], CHASSIS_CONTACT_OFFSETS = [[-.95, -.1, 2.25], [.95, -.1, 2.25], [-.95, -.1, -2.25], [.95, -.1, -2.25], [-.7, .62, .8], [.7, .62, .8], [-.7, .62, -.9], [.7, .62, -.9]];
const vehicleState = {
    p: createVector(),
    q: new THREE_NS.Quaternion(),
    v: createVector(),
    w: createVector(),
    fuel: 100,
    tl: 0,
    steer: 0,
    g: createVector(0, 1, 0),
    gp: 1,
    ad: 0,
    steep: 1,
    auto: true,
    lev: false,
    nc: 0,
    air: 0,
    t0: createVector(),
    lastVy: 0,
    sp: 0,
    best: 0,
    jump: 0,
    maxH: 0,
    wo: 0,
    shake: 0,
    drifting: false,
    rotPitch: 0, rotRoll: 0, rotYaw: 0
};
let wallGripEnabled = true; // G toggles wall grip, including automatic engagement on steep surfaces.
const inputKeys = {}, KM = {
    KeyW: 'W',
    ArrowUp: 'W',
    KeyS: 'S',
    ArrowDown: 'S',
    KeyA: 'A',
    ArrowLeft: 'A',
    KeyD: 'D',
    ArrowRight: 'D',
    KeyQ: 'Q',
    KeyE: 'E',
    Space: 'Space',
    KeyF: 'F',
    KeyZ: 'Z',
    KeyC: 'C',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift'
};
/* ---------- collision: terrain normals, surface contact, solid obstacles ---------- */
function getTerrainNormal(x, z) {
    const e = .6, n = createVector(getSurfaceHeight(x - e, z) - getSurfaceHeight(x + e, z), 2 * e, getSurfaceHeight(x, z - e) - getSurfaceHeight(x, z + e)).normalize();
    return n.y < .6 ? createVector(0, 1, 0) : n;
}
function tunnelContact(P) {
    if (P.z < TUNNEL.z0 - 0.25 || P.z > TUNNEL.z1 + 0.25)
        return null;
    const dx = P.x - TUNNEL.x;
    const dy = P.y - TUNNEL.y;
    const radialDistance = Math.hypot(dx, dy);
    // Only resolve points on or just inside the tunnel lining; ignore its open ends.
    if (radialDistance < 0.05 || radialDistance > TUNNEL.radius + 0.35)
        return null;
    return [
        TUNNEL.radius - radialDistance,
        createVector(-dx / radialDistance, -dy / radialDistance, 0)
    ];
}
function getSurfaceContact(P) {
    let contact = [P.y - getSurfaceHeight(P.x, P.z), getTerrainNormal(P.x, P.z)];
    const profileContact = getProfileContact(P);
    if (profileContact && profileContact[0] < contact[0])
        contact = profileContact;
    const tunnel = tunnelContact(P);
    if (tunnel && tunnel[0] < contact[0])
        contact = tunnel;
    return contact;
}
const clamp = (x, a = -1, b = 1) => Math.max(a, Math.min(b, x));
/* Probes around the body detect sheer faces of walls, pillars and block edges and push the car out
   horizontally (the height-field alone would shove the car on top of them). */
const SOLID_PROBES = [[0, 2.3], [0, -2.3], [1.0, 0], [-1.0, 0], [.95, 2.0], [-.95, 2.0], [.95, -2.0], [-.95, -2.0], [.9, .9], [-.9, .9], [.9, -.9], [-.9, -.9]];
const RING8 = [[1, 0], [.707, .707], [0, 1], [-.707, .707], [-1, 0], [-.707, -.707], [0, -1], [.707, -.707]];
let lastCrashFx = 0;
function crashFx(imp, p) {
    const now = performance.now();
    if (now - lastCrashFx < 140) return;
    lastCrashFx = now;
    sparkBurst(p.clone().add(createVector(0, .3, 0)), Math.min(26, 6 + (imp | 0)), 3, 9, .55, .45);
    noiseBurst(Math.min(.6, .12 + imp * .032), .3, 280);
    blip(70, .18, 'square', Math.min(.3, .05 + imp * .018), .45);
    if (imp > 7) breakCombo();
}
function resolveSolids(p, v, q) {
    let bestDepth = 0, bestN = null;
    for (let i = 0; i < SOLID_PROBES.length; i++) {
        const pr = SOLID_PROBES[i], off = createVector(pr[0], -.1, pr[1]).applyQuaternion(q);
        const px = p.x + off.x, py = p.y + off.y, pz = p.z + off.z;
        if (getSurfaceHeight(px, pz) - py <= .9) continue;
        let dx = p.x - px, dz = p.z - pz;
        const len = Math.hypot(dx, dz);
        if (len < 1e-4) continue;
        dx /= len; dz /= len;
        let s = 0, found = false, hPrev = getSurfaceHeight(px, pz), fx = px, fz = pz;
        for (; s < len + .6; s += .15) {
            const hN = getSurfaceHeight(px + dx * (s + .15), pz + dz * (s + .15));
            if (hPrev - hN > .5) { found = true; fx = px + dx * s; fz = pz + dz * s; break; }
            hPrev = hN;
        }
        if (!found) continue;
        const hf = getSurfaceHeight(fx, fz);
        let nx = 0, nz = 0;
        for (let k = 0; k < 8; k++) if (getSurfaceHeight(fx + RING8[k][0] * .4, fz + RING8[k][1] * .4) < hf - .5) { nx += RING8[k][0]; nz += RING8[k][1]; }
        let nl = Math.hypot(nx, nz);
        if (nl < 1e-3) { nx = dx; nz = dz; } else { nx /= nl; nz /= nl; }
        const depth = Math.max(.02, s * Math.abs(nx * dx + nz * dz)) + .04;
        if (depth > bestDepth) { bestDepth = depth; bestN = [nx, nz]; }
    }
    if (bestN) {
        const nx = bestN[0], nz = bestN[1], d = Math.min(bestDepth, 1.5);
        p.x += nx * d; p.z += nz * d;
        const vn = v.x * nx + v.z * nz;
        if (vn < 0) {
            v.x -= nx * vn * 1.25; v.z -= nz * vn * 1.25;
            if (-vn > 3) { vehicleState.shake = Math.max(vehicleState.shake, Math.min(.8, -vn / 25)); crashFx(-vn, p); }
        }
    }
}
/* thrusters: 0-3 bottom (FL,FR,RL,RR), 4-7 side (left/right, front/rear), 8 main rocket */
const thrusters = [], THRUSTER_QUADRANTS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
THRUSTER_QUADRANTS.forEach(([sx, sz]) => thrusters.push({
    sx,
    sz,
    r: createVector(sx * .8, -.2, sz > 0 ? 1.4 : -1.35),
    d: createVector(0, 1, 0),
    m: 7500,
    l: 0,
    c: 0,
    b: 2.5
}));
THRUSTER_QUADRANTS.forEach(([sx, sz]) => thrusters.push({
    sx,
    sz,
    r: createVector(sx, .35, sz * 1.3),
    d: createVector(-sx, 0, 0),
    m: 5000,
    l: 0,
    c: 0,
    b: 2
}));
thrusters.push({
    sx: 0,
    sz: -1,
    r: createVector(0, -.1, -2.3),
    d: createVector(0, 0, 1),
    m: 36000,
    l: 0,
    c: 0,
    b: 9
});
function updatePhysics(h) {
    const { p, q, v, w } = vehicleState, qi = q.clone().invert(), fw = createVector(0, 0, 1).applyQuaternion(q), Fn = createVector(0, -9.81 * VEHICLE_MASS, 0), Tq = createVector(), spd = v.length(), thr = (inputKeys.W | 0) - (inputKeys.S | 0), str = (inputKeys.A | 0) - (inputKeys.D | 0);
    let nc = 0, ny = 1;
    const act = (r, f) => {
        Fn.add(f);
        Tq.add(r.clone().cross(f));
    };
    // Stable collision recovery: solve the deepest penetration once per physics step.
    // The previous per-wheel correction moved the chassis several times in one step,
    // which could cause small visible jerks while rolling across uneven contacts.
    const contactOffsets = [];
    WHEEL_CONTACT_OFFSETS.forEach(a => contactOffsets.push(createVector(a[0], 0, a[1]).applyQuaternion(q)));
    CHASSIS_CONTACT_OFFSETS.forEach(a => contactOffsets.push(createVector(a[0], a[1], a[2]).applyQuaternion(q)));
    let correctionDepth = 0;
    let correctionNormal = null;
    for (const offset of contactOffsets) {
        const [distance, normal] = getSurfaceContact(p.clone().add(offset));
        const depth = -distance - 0.025; // small contact slop prevents surface chatter
        if (depth > correctionDepth && depth < 1.2) {
            correctionDepth = depth;
            correctionNormal = normal;
        }
    }
    if (correctionNormal && correctionDepth > 0) {
        const correction = Math.min(correctionDepth * 0.35, 0.1);
        p.addScaledVector(correctionNormal, correction);
    }
    // Natural brake-to-drift: brake while steering at speed to loosen rear grip.
    // Keep this to ground driving; it should not alter wall riding or airborne control.
    const driftRequested = !!inputKeys.S && Math.abs(str) > 0 && spd > 7.5 && vehicleState.nc >= 3 && vehicleState.steep > 0.55;
    vehicleState.drifting = driftRequested;
    const steerAuthority = driftRequested ? 0.72 : 0.5;
    const steerSpeedScale = driftRequested ? 20 : 14;
    vehicleState.steer += (str * steerAuthority / (1 + spd / steerSpeedScale) - vehicleState.steer) * Math.min(1, h * 8);
    const gripRequested = wallGripEnabled && (inputKeys.Shift || (vehicleState.auto && vehicleState.steep < 0.9));
    // Release grip faster than it engages, so the car can cleanly leave a wall ride.
    const gripResponse = gripRequested ? 6 : 12;
    vehicleState.ad += ((gripRequested ? 1 : 0) - vehicleState.ad) * Math.min(1, h * gripResponse);
    WHEEL_CONTACT_OFFSETS.forEach(a => {
        const r = createVector(a[0], 0, a[1]).applyQuaternion(q);
        const P = p.clone().add(r);
        const [d, n] = getSurfaceContact(P);
        if (d > LEN || d < -1.15)
            return;
        const vw = v.clone().add(w.clone().cross(r));
        // Damped suspension: the previous low damping let the chassis oscillate on the
        // wheels, which felt like a small recurring jerk until the rocket unloaded them.
        const suspensionCompression = clamp(LEN - d, 0, 0.24);
        const suspensionVelocity = clamp(vw.dot(n), -2.5, 2.5);
        const N = clamp(60000 * suspensionCompression - 8500 * suspensionVelocity, 0, 22000);
        nc++;
        ny = Math.min(ny, n.y);
        const f = fw.clone().addScaledVector(n, -fw.dot(n)).normalize();
        if (a[2])
            f.applyAxisAngle(n, vehicleState.steer);
        const s = n.clone().cross(f), vl = vw.dot(s), vf = vw.dot(f), mx = 1.2 * N;
        let Fx = -vf * (vehicleState.ad > .3 && !thr ? 8000 : 60);
        // Stronger wheel-driven acceleration so W is useful without the rocket thruster.
        if (thr > 0 && !a[2])
            Fx += 10000 * Math.max(0, 1 - spd / 85);
        if (thr < 0)
            Fx -= vf > 2 ? 3500 : (a[2] ? 0 : Math.max(0, 3000 * (1 + vf / 12)));
        // Braking transfers load forward; reduced rear lateral grip lets the rear rotate naturally.
        if (driftRequested && !a[2])
            Fx -= Math.min(1200, Math.abs(vf) * 22);
        const lateralGrip = driftRequested ? (a[2] ? 3600 : 1050) : 7500;
        act(r, n.clone().multiplyScalar(N - vehicleState.ad * 14000).addScaledVector(f, clamp(Fx, -mx, mx)).addScaledVector(s, -clamp(vl * lateralGrip, -mx, mx)));
    });
    /* ad = suction fans pressing wheels to the surface */
    CHASSIS_CONTACT_OFFSETS.forEach(a => {
        const r = createVector(a[0], a[1], a[2]).applyQuaternion(q);
        const P = p.clone().add(r);
        const [d, n] = getSurfaceContact(P);
        if (d < 0 && d > -1.25) {
            const vw = v.clone().add(w.clone().cross(r));
            const N = Math.max(0, 120000 * -d - 5000 * vw.dot(n));
            // Keep the body planted, but don't let contact damping overpower wheel drive on walls.
            const gripContact = vehicleState.ad > 0.3;
            const tangentialDamping = gripContact ? 65 : 1500;
            const frictionLimit = (gripContact ? 0.16 : 0.6) * N;
            const fh = vw.addScaledVector(n, -vw.dot(n)).multiplyScalar(-tangentialDamping).clampLength(0, frictionLimit);
            act(r, n.clone().multiplyScalar(N).add(fh));
        }
    });
    Fn.addScaledVector(v, -.42 * spd);
    /* aero drag: 1/2 rho Cd A v^2 */
    /* Pilot controls flight; AUTO only takes over to stabilize and soften the landing. */
    const alt = p.y - getSurfaceHeight(p.x, p.z) - .5, up = createVector(0, 1, 0).applyQuaternion(q), xb = createVector(1, 0, 0).applyQuaternion(q), air = nc < 3, hasF = vehicleState.fuel > 0;
    let base = 0, pt = 0, rl = 0, yw = 0, ly = 0;
    vehicleState.lev = false;
    if (air && hasF) {
        if (vehicleState.auto) {
            const ax = up.clone().cross(createVector(0, 1, 0)), ang = Math.acos(clamp(up.y)), eb = (ax.lengthSq() > 1e-8 ? ax.normalize().multiplyScalar(ang) : createVector(0, 0, ang)).applyQuaternion(qi), wl = w.clone().applyQuaternion(qi);
            const tg = alt / Math.max(-v.y, 1), lev = tg < 1.8 + 0.65 * ang || alt < 5, qy = (inputKeys.Q | 0) - (inputKeys.E | 0);
            vehicleState.lev = lev;
            /* pilot rotates freely until the autopilot must level for landing */
            if (lev) {
                pt = clamp((6 * eb.x - 3.6 * wl.x) / 7.9);
                rl = clamp((8 * eb.z - 4.5 * wl.z) / 17);
            }
            else {
                pt = clamp(4 * (thr * 2.2 - wl.x) / 7.9);
                rl = clamp(6 * (-str * 2.6 - wl.z) / 17);
            }
            const vh = createVector(v.x, 0, v.z), fh = createVector(fw.x, 0, fw.z);
            let ey = 0;
            if (vh.length() > 6 && fh.lengthSq() > .05) {
                vh.normalize();
                fh.normalize();
                ey = Math.acos(clamp(fh.dot(vh))) * Math.sign(fh.clone().cross(vh).y);
            }
            yw = lev ? clamp((3 * ey - 2.4 * wl.y) / 4.6) : clamp(4 * (qy * 2.2 - wl.y) / 4.6);
            /* Correct sideways drift only during the landing-assist phase. */
            ly = lev ? clamp(-v.dot(xb) * .3) : 0;
            if (alt < 70 && v.y < -2 && up.y > .5) {
                // Begin braking against a gentler target descent profile, with a stronger response.
                const vt = -(1.0 + Math.sqrt(6 * Math.max(alt, 0)));
                base = clamp(VEHICLE_MASS * (9.81 + 3.6 * (vt - v.y)) / (Math.max(.3, up.y) * 30000), 0, 1);
            }
        }
        else {
            pt = thr;
            rl = -str;
            yw = (inputKeys.Q | 0) - (inputKeys.E | 0);
            ly = (inputKeys.Z | 0) - (inputKeys.C | 0);
        }
    }
    /* F manually fires the bottom thrusters in either mode. */
    if (hasF && inputKeys.F)
        base = 1;
    thrusters.forEach((t, i) => {
        t.c = i < 4 ? clamp(base + pt * -t.sz + rl * t.sx, 0, 1) : i < 8 ? clamp(-ly * t.sx - yw * t.sz * t.sx, 0, 1) : (inputKeys.Space && hasF ? 1 : 0);
    });
    // Give the bottom thrusters extra authority only while AUTO is actively assisting a landing.
    const landingThrusterBoost = vehicleState.auto && air && vehicleState.lev && alt < 80 && v.y < 0 ? 1.3 : 1;
    // Wall grip is an aerodynamic/mechanical assist and does not consume fuel.
    let use = 0;
    thrusters.forEach((t, i) => {
        t.l += (t.c - t.l) * Math.min(1, h * 12);
        if (t.l > .01) {
            const thrustScale = i < 4 ? landingThrusterBoost : 1;
            act(t.r.clone().applyQuaternion(q), t.d.clone().applyQuaternion(q).multiplyScalar(t.m * t.l * thrustScale));
            use += t.b * t.l;
        }
    });
    /* F=T*d, torque=r x F */
    vehicleState.tl = thrusters[8].l;
    Tq.addScaledVector(w, -400);
    vehicleState.fuel = clamp(vehicleState.fuel - use * h + (nc >= 3 && thrusters.every(t => t.l < .05) && vehicleState.ad < .05 ? 8 * h : 0), 0, 100);
    vehicleState.g.lerp(Fn.clone().sub(createVector(0, -9.81 * VEHICLE_MASS, 0)).divideScalar(VEHICLE_MASS * 9.81).applyQuaternion(qi), 1 - Math.exp(-h / .05));
    vehicleState.steep = nc ? ny : 1;
    /* G-force = specific force in body frame */
    v.addScaledVector(Fn, h / VEHICLE_MASS);
    const tb = Tq.applyQuaternion(qi), wb = w.clone().applyQuaternion(qi);
    wb.x += tb.x / VEHICLE_INERTIA[0] * h;
    wb.y += tb.y / VEHICLE_INERTIA[1] * h;
    wb.z += tb.z / VEHICLE_INERTIA[2] * h;
    w.copy(wb.applyQuaternion(q));
    const wq = new THREE_NS.Quaternion(w.x, w.y, w.z, 0).multiply(q);
    q.set(q.x + .5 * h * wq.x, q.y + .5 * h * wq.y, q.z + .5 * h * wq.z, q.w + .5 * h * wq.w).normalize();
    const pv0 = p.clone();
    p.addScaledVector(v, h);
    const pq = getProfileContact(p);
    if (pq && pq[0] < .2) {
        p.addScaledVector(pq[1], .2 - pq[0]);
        const vn = v.dot(pq[1]);
        if (vn < 0)
            v.addScaledVector(pq[1], -vn);
    }
    const hc = getSurfaceHeight(p.x, p.z);
    resolveSolids(p, v, q);
    if (p.y < -30 || Math.abs(p.x) > 560 || p.z < -420 || p.z > 920)
        respawn();
    if (nc === 0) {
        if (vehicleState.air === 0) {
            vehicleState.t0.copy(p);
            vehicleState.maxH = 0;
            vehicleState.rotPitch = vehicleState.rotRoll = vehicleState.rotYaw = 0;
        }
        { const wlr = w.clone().applyQuaternion(qi); vehicleState.rotPitch += wlr.x * h; vehicleState.rotRoll += wlr.z * h; vehicleState.rotYaw += wlr.y * h; }
        vehicleState.air += h;
        vehicleState.lastVy = v.y;
        vehicleState.maxH = Math.max(vehicleState.maxH, p.y - hc);
    }
    else {
        if (vehicleState.air > .6)
            handleLanding();
        vehicleState.air = 0;
    }
    vehicleState.nc = nc;
    updateBoostPads(h);
}
function handleLanding() {
    const d = Math.hypot(vehicleState.p.x - vehicleState.t0.x, vehicleState.p.z - vehicleState.t0.z), imp = -vehicleState.lastVy;
    vehicleState.jump = d;
    vehicleState.best = Math.max(vehicleState.best, d);
    vehicleState.shake = Math.min(1, imp / 18);
    playLandingImpact(imp);
    scoreLanding(d, vehicleState.air, vehicleState.maxH, imp);
    for (let i = 0; i < 40; i++)
        emitParticle(vehicleState.p.clone().add(createVector(randomOffset(3), -.4, randomOffset(4))), createVector(randomOffset(10), Math.random() * 3, randomOffset(10)), 1.2, 1);
}
let toastTimeoutId;
function showToast(m) {
    const e = getElement('toast');
    e.innerHTML = m;
    e.style.opacity = 1;
    clearTimeout(toastTimeoutId);
    toastTimeoutId = setTimeout(() => e.style.opacity = 0, 2400);
}

/* ======================================================================
   GAMEPLAY: score & combos, orbs, hoops, boost pads, smashables,
   checkpoints, minimap, pickup sounds
   ====================================================================== */
const G = {
    score: 0, combo: 0, mult: 1, comboT: 0, orbs: 0, hoops: 0, smashed: 0, cp: 0,
    best: (() => { try { return +localStorage.getItem('rtl_best') || 0; } catch (e) { return 0; } })(),
    driftAcc: 0, wallAcc: 0, driftT: 0, wallT: 0, smashAcc: 0, smashT: 0, smashN: 0, orbChain: 0, orbChainT: 0,
    boostFx: 0, boostLatch: 0, bestTrick: 0, zone: '', zoneT: 0, tricks: 0
};
const saveBest = () => { try { localStorage.setItem('rtl_best', String(Math.floor(G.best))); } catch (e) { } };
function blip(freq, dur = .12, type = 'sine', vol = .12, slide = 0) {
    const ctx = soundState.context;
    if (!ctx || !soundState.enabled || !soundState.master) return;
    const now = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, now);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), now + dur);
    g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(.001, now + dur);
    o.connect(g); g.connect(soundState.master);
    o.start(now); o.stop(now + dur + .02);
}
function noiseBurst(vol = .2, dur = .18, freq = 900) {
    const ctx = soundState.context;
    if (!ctx || !soundState.enabled || !soundState.noiseBuffer) return;
    const now = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = soundState.noiseBuffer; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = .8;
    g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(.001, now + dur);
    s.connect(f); f.connect(g); g.connect(soundState.master);
    s.start(now, Math.random()); s.stop(now + dur + .02);
}
const popsEl = getElement('pops');
function popup(text, cls = '') {
    if (!popsEl) return;
    const d = document.createElement('div');
    d.className = 'pop ' + cls;
    d.innerHTML = text;
    popsEl.appendChild(d);
    while (popsEl.children.length > 6) popsEl.removeChild(popsEl.firstChild);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 1900);
}
const fmt = n => Math.floor(n).toLocaleString('en-US');
function addScore(base, label, cls) {
    const pts = Math.round(base * G.mult);
    G.score += pts;
    G.combo++;
    G.comboT = 5;
    G.mult = Math.min(10, 1 + Math.floor(G.combo / 2));
    if (G.score > G.best) { G.best = G.score; }
    if (label) popup(`${label} <b>+${fmt(pts)}</b>` + (G.mult > 1 ? ` <i>x${G.mult}</i>` : ''), cls);
    return pts;
}
function breakCombo() { G.combo = 0; G.mult = 1; G.comboT = 0; }

/* ---------------- checkpoints ---------------- */
const gateMats = [];
checkpoints.forEach((c, i) => {
    const mat = new THREE_NS.MeshBasicMaterial({ color: new THREE_NS.Color(.35, 1.0, 2.4) });
    gateMats.push(mat);
    if (i === 0) return;
    const gy = getSurfaceHeight(c.x, c.z), fx = Math.sin(c.heading), fz = Math.cos(c.heading), rx = fz, rz = -fx;
    const grp = new THREE_NS.Group();
    [-1, 1].forEach(s => {
        const m = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(.5, 6.5, .5), mat);
        m.position.set(c.x + rx * s * 8.5, gy + 3.25, c.z + rz * s * 8.5); grp.add(m);
        const b = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(1.1, .5, 1.1), new THREE_NS.MeshStandardMaterial({ color: 0x3a3a55, roughness: .4, metalness: .6 }));
        b.position.set(c.x + rx * s * 8.5, gy + .25, c.z + rz * s * 8.5); grp.add(b);
    });
    const top = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(17.5, .35, .35), mat);
    top.position.set(c.x, gy + 6.5, c.z); top.rotation.y = c.heading + PI / 2; grp.add(top);
    const tp = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(17.5, .12, .12), mat);
    tp.position.set(c.x, gy + 5.9, c.z); tp.rotation.y = c.heading + PI / 2; grp.add(tp);
    scene.add(grp);
});
function activateCheckpoint(i) {
    if (G.cp === i) return;
    G.cp = i;
    gateMats[i].color.setRGB(.5, 2.6, .8);
    showToast('CHECKPOINT<br>' + checkpoints[i].name);
    blip(660, .12, 'triangle', .14); setTimeout(() => blip(990, .2, 'triangle', .14), 90);
}
function respawn(i = G.cp, silent) {
    const c = checkpoints[i] || checkpoints[0], s = vehicleState;
    s.p.set(c.x, getSurfaceHeight(c.x, c.z) + .55 + (c.y || 0), c.z);
    s.v.set(0, 0, 0); s.w.set(0, 0, 0);
    s.q.setFromAxisAngle(createVector(0, 1, 0), c.heading);
    s.fuel = 100; s.air = 0; s.tl = 0; s.ad = 0; s.steep = 1; s.steer = 0; s.jump = 0; s.drifting = false;
    s.g.set(0, 1, 0);
    thrusters.forEach(t => t.l = t.c = 0);
    cameraHeading = c.heading;
    G.driftAcc = G.wallAcc = 0; breakCombo();
    if (!silent) showToast(i === 0 ? 'BACK TO START' : 'RESPAWN<br>' + c.name);
}

/* ---------------- orbs ---------------- */
const orbCount = orbSpawns.length, orbCollected = new Uint8Array(orbCount);
const orbMesh = new THREE_NS.InstancedMesh(new THREE_NS.OctahedronGeometry(.62, 0), new THREE_NS.MeshBasicMaterial({ color: new THREE_NS.Color(4.2, 1.6, 1.6) }), orbCount);
orbMesh.frustumCulled = false;
scene.add(orbMesh);
const orbHaloPos = new Float32Array(orbCount * 3), orbHaloAttr = new THREE_NS.InstancedBufferAttribute(orbHaloPos, 3).setUsage(THREE_NS.DynamicDrawUsage);
const orbHalo = new THREE_NS.Sprite(new THREE_NS.PointsNodeMaterial({ map: glowTex, color: new THREE_NS.Color(1, .35, .25), size: 3.6, sizeAttenuation: true, transparent: true, opacity: .55, blending: THREE_NS.AdditiveBlending, depthWrite: false, positionNode: instancedBufferAttribute(orbHaloAttr) }));
orbHalo.count = Math.max(1, orbCount);
orbHalo.frustumCulled = false;
scene.add(orbHalo);
const _m4 = new THREE_NS.Matrix4(), _q4 = new THREE_NS.Quaternion(), _s4 = new THREE_NS.Vector3(), _p4 = new THREE_NS.Vector3(), _e4 = new THREE_NS.Euler();
function updateOrbs(t, p) {
    for (let i = 0; i < orbCount; i++) {
        const o = orbSpawns[i];
        if (orbCollected[i]) { _s4.set(0, 0, 0); _m4.compose(_p4.set(0, -999, 0), _q4.identity(), _s4); orbMesh.setMatrixAt(i, _m4); orbHaloPos[i * 3 + 1] = -999; continue; }
        const bob = Math.sin(t * 2.2 + i * .9) * .28, pulse = 1 + Math.sin(t * 5 + i) * .08;
        _e4.set(t * 1.3 + i, t * 1.7, 0); _q4.setFromEuler(_e4); _s4.set(pulse, pulse, pulse);
        _m4.compose(_p4.set(o[0], o[1] + bob, o[2]), _q4, _s4);
        orbMesh.setMatrixAt(i, _m4);
        orbHaloPos[i * 3] = o[0]; orbHaloPos[i * 3 + 1] = o[1] + bob; orbHaloPos[i * 3 + 2] = o[2];
        const dx = p.x - o[0], dy = p.y - o[1], dz = p.z - o[2];
        if (dx * dx + dy * dy + dz * dz < 12.5) collectOrb(i);
    }
    orbMesh.instanceMatrix.needsUpdate = true;
    orbHaloAttr.needsUpdate = true;
}
function sparkBurst(pos, n, kind, spd = 8, life = .6, size = .5) {
    for (let i = 0; i < n; i++) emitParticle(pos, createVector(randomOffset(spd), Math.random() * spd * .8, randomOffset(spd)), life * (.6 + Math.random() * .8), kind, size);
}
function collectOrb(i) {
    orbCollected[i] = 1; G.orbs++;
    const o = orbSpawns[i];
    G.orbChain = G.orbChainT > 0 ? G.orbChain + 1 : 0; G.orbChainT = 1.4;
    addScore(100, null);
    popup(`CORE <b>+${fmt(100 * G.mult)}</b>`, 'small');
    vehicleState.fuel = Math.min(100, vehicleState.fuel + 12);
    blip(520 * Math.pow(2, Math.min(G.orbChain, 12) / 12), .16, 'sine', .13, 1.6);
    sparkBurst(createVector(o[0], o[1], o[2]), 16, 5, 9, .6, .5);
    if (G.orbs === orbCount) { showToast('ALL DATA CORES RECOVERED'); addScore(5000, 'FULL DATASET', 'big'); }
}

/* ---------------- hoops ---------------- */
const hoops = hoopSpawns.map(h => {
    const mat = new THREE_NS.MeshBasicMaterial({ color: new THREE_NS.Color(3.2, .5, .4), transparent: true, opacity: .95 });
    const m = new THREE_NS.Mesh(new THREE_NS.TorusGeometry(h.r, .3, 10, 56), mat);
    const n = createVector(...h.nrm).normalize();
    m.quaternion.setFromUnitVectors(createVector(0, 0, 1), n);
    m.position.set(h.x, h.y, h.z);
    const disc = new THREE_NS.Mesh(new THREE_NS.CircleGeometry(h.r - .2, 40), new THREE_NS.MeshBasicMaterial({ color: new THREE_NS.Color(.9, .1, .1), transparent: true, opacity: .1, side: THREE_NS.DoubleSide, depthWrite: false, blending: THREE_NS.AdditiveBlending }));
    m.add(disc);
    const sp = glowSpriteAt(new THREE_NS.Color(1.6, .3, .3), h.r * 2.6, h.x, h.y, h.z, .16, scene);
    scene.add(m);
    return { h, m, mat, n, sp, done: false, fade: 0 };
});
const hoopPrev = createVector(); let hoopPrevSet = false;
function updateHoops(t, p) {
    hoops.forEach((q, i) => {
        if (q.done) {
            q.fade += .03; q.m.scale.setScalar(1 + q.fade * .5); q.mat.opacity = Math.max(.12, .9 - q.fade); q.mat.color.setRGB(2.4, 1.6, .4); q.sp.material.opacity = Math.max(0, .16 - q.fade * .2);
            q.m.rotation.z += .01;
            return;
        }
        q.m.scale.setScalar(1 + Math.sin(t * 3 + i) * .02);
        if (!hoopPrevSet) return;
        const c = q.h, d0 = (hoopPrev.x - c.x) * q.n.x + (hoopPrev.y - c.y) * q.n.y + (hoopPrev.z - c.z) * q.n.z, d1 = (p.x - c.x) * q.n.x + (p.y - c.y) * q.n.y + (p.z - c.z) * q.n.z;
        if (d0 * d1 < 0) {
            const k = d0 / (d0 - d1), cx = hoopPrev.x + (p.x - hoopPrev.x) * k, cy = hoopPrev.y + (p.y - hoopPrev.y) * k, cz = hoopPrev.z + (p.z - hoopPrev.z) * k;
            if (Math.hypot(cx - c.x, cy - c.y, cz - c.z) < c.r * 1.12) {
                q.done = true; G.hoops++;
                addScore(300, 'HOOP', 'hoop');
                vehicleState.fuel = Math.min(100, vehicleState.fuel + 25);
                blip(440, .1, 'square', .08); setTimeout(() => blip(880, .22, 'sine', .14, 1.5), 70);
                sparkBurst(createVector(c.x, c.y, c.z), 30, 5, 14, .9, .6);
            }
        }
    });
    hoopPrev.copy(p); hoopPrevSet = true;
}

/* ---------------- boost pads ---------------- */
const padUniform = { time: uniform(0) };
const padMat = new THREE_NS.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, blending: THREE_NS.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
{
    const u = uv(), x = u.x.sub(.5).mul(2), y = u.y.mul(3).sub(padUniform.time.mul(2.2)), d = fract(y.add(abs(x).mul(.55)));
    const chev = smoothstep(0, .1, d).mul(smoothstep(.22, .42, d).oneMinus());
    const edge = smoothstep(0, .07, u.x).mul(smoothstep(1, .93, u.x));
    const rim = smoothstep(0, .06, min(min(u.x, u.x.oneMinus()), min(u.y, u.y.oneMinus()))).oneMinus();
    const a = chev.mul(.95).add(.16).mul(edge).add(rim.mul(.9));
    padMat.fragmentNode = vec4(vec3(.25, 2.4, 1.5).mul(a), a);
}
boostPads.forEach(b => {
    const g = new THREE_NS.PlaneGeometry(b.wid, b.len);
    g.rotateX(-PI / 2);
    const m = new THREE_NS.Mesh(g, padMat);
    m.position.set(b.x, getSurfaceHeight(b.x, b.z) + .07, b.z);
    m.rotation.y = Math.atan2(b.dx, b.dz);
    m.renderOrder = 3;
    scene.add(m);
});
function updateBoostPads(h) {
    const s = vehicleState, p = s.p, v = s.v;
    let on = false;
    for (let i = 0; i < boostPads.length; i++) {
        const b = boostPads[i], rx = p.x - b.x, rz = p.z - b.z, al = rx * b.dx + rz * b.dz, la = -rx * b.dz + rz * b.dx;
        if (Math.abs(al) < b.len / 2 && Math.abs(la) < b.wid / 2 + 1 && p.y - getSurfaceHeight(p.x, p.z) < 3) {
            on = true;
            const along = v.x * b.dx + v.z * b.dz, cap = 46 * b.power;
            if (along < cap) { const a = Math.min(cap - along, 55 * b.power * h); v.x += b.dx * a; v.z += b.dz * a; }
        }
    }
    if (on && !G.boostLatch) { G.boostFx = 1; blip(180, .5, 'sawtooth', .09, 4); noiseBurst(.12, .4, 1800); popup('BOOST', 'small boost'); }
    G.boostLatch = on ? 1 : 0;
}

/* ---------------- smashables (crates + barrels) ---------------- */
const crateTex = (() => {
    const [c, x] = mkCanvas(128);
    x.fillStyle = '#6e6e86'; x.fillRect(0, 0, 128, 128);
    x.strokeStyle = '#ffffff'; x.lineWidth = 12; x.strokeRect(6, 6, 116, 116);
    x.lineWidth = 7; x.beginPath(); x.moveTo(14, 14); x.lineTo(114, 114); x.moveTo(114, 14); x.lineTo(14, 114); x.stroke();
    x.fillStyle = '#2a2a3c'; x.fillRect(46, 46, 36, 36);
    return canvasTex(c);
})();
const barrelTex = (() => {
    const [c, x] = mkCanvas(64, 128);
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 128);
    x.fillStyle = '#3a3a48';
    x.fillRect(0, 12, 64, 12); x.fillRect(0, 52, 64, 22); x.fillRect(0, 104, 64, 12);
    const t = canvasTex(c); return t;
})();
const crateSpawns = smashSpawns.filter(s => s.type === 'crate'), barrelSpawns = smashSpawns.filter(s => s.type === 'barrel');
const smashPalette = [[.92, .96, 1.0], [.3, .8, 1.0], [1.0, .68, .2]];
const crateMesh = new THREE_NS.InstancedMesh(new THREE_NS.BoxGeometry(1, 1, 1), new THREE_NS.MeshStandardMaterial({ map: crateTex, emissiveMap: crateTex, emissive: new THREE_NS.Color(.35, .35, .35), roughness: .55, metalness: .35, envMapIntensity: .9 }), Math.max(1, crateSpawns.length));
const barrelMesh = new THREE_NS.InstancedMesh(new THREE_NS.CylinderGeometry(.5, .5, 1, 16), new THREE_NS.MeshStandardMaterial({ map: barrelTex, roughness: .5, metalness: .4, envMapIntensity: .9 }), Math.max(1, barrelSpawns.length));
crateMesh.count = crateSpawns.length; barrelMesh.count = barrelSpawns.length;
[crateMesh, barrelMesh].forEach(m => { m.castShadow = m.receiveShadow = true; m.instanceMatrix.setUsage(THREE_NS.DynamicDrawUsage); scene.add(m); m.frustumCulled = false; });
const smashables = [];
function makeSmash(spawn, mesh, idx, bar) {
    const c = smashPalette[spawn.col % smashPalette.length], col = bar ? new THREE_NS.Color(spawn.col === 1 ? .3 : 1.0, spawn.col === 1 ? .7 : .62, spawn.col === 1 ? 1 : .2) : new THREE_NS.Color(c[0], c[1], c[2]);
    mesh.setColorAt(idx, col);
    return { mesh, idx, bar, x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0, rx: 0, ry: spawn.yaw, rz: 0, wx: 0, wy: 0, wz: 0, s: spawn.size, awake: false, rest: 0, dirty: true, smashed: false };
}
crateSpawns.forEach((s, i) => smashables.push(makeSmash(s, crateMesh, i, false)));
barrelSpawns.forEach((s, i) => smashables.push(makeSmash(s, barrelMesh, i, true)));
if (crateMesh.instanceColor) crateMesh.instanceColor.needsUpdate = true;
if (barrelMesh.instanceColor) barrelMesh.instanceColor.needsUpdate = true;
const smashGrid = new Map();
const sgKey = (x, z) => Math.floor(x / 4) * 4096 + Math.floor(z / 4);
smashables.forEach((o, i) => { const k = sgKey(o.x, o.z); let a = smashGrid.get(k); if (!a) smashGrid.set(k, a = []); a.push(i); });
const awakeList = [];
function wakeSmash(o, vx, vy, vz) {
    if (o.awake) return;
    o.awake = true; o.vx = vx; o.vy = vy; o.vz = vz; o.rest = 0; awakeList.push(o);
    /* wake anything resting on top of it */
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const a = smashGrid.get(sgKey(o.x + dx * 4, o.z + dz * 4));
        if (!a) continue;
        for (const j of a) { const q = smashables[j]; if (!q.awake && q.y > o.y + .1 && Math.abs(q.x - o.x) < o.s * 1.3 && Math.abs(q.z - o.z) < o.s * 1.3 && q.y - o.y < o.s * 1.6) wakeSmash(q, vx * .3, 0, vz * .3); }
    }
}
const _qs = new THREE_NS.Quaternion(), _es = new THREE_NS.Euler(), _ps = new THREE_NS.Vector3(), _ss = new THREE_NS.Vector3(), _ms = new THREE_NS.Matrix4();
function writeSmash(o) {
    _es.set(o.rx, o.ry, o.rz); _qs.setFromEuler(_es);
    _ss.set(o.s, o.s * (o.bar ? .95 : 1), o.s);
    _ms.compose(_ps.set(o.x, o.y, o.z), _qs, _ss);
    o.mesh.setMatrixAt(o.idx, _ms);
}
smashables.forEach(writeSmash);
crateMesh.instanceMatrix.needsUpdate = true; barrelMesh.instanceMatrix.needsUpdate = true;
let crateDirty = false;
function updateSmashables(dt) {
    const s = vehicleState, p = s.p, q = s.q, v = s.v, qi = q.clone().invert(), carSpd = v.length();
    let hits = 0, slow = 0;
    /* car vs crates: oriented box test in car space */
    if (carSpd > 1.5 || s.tl > .1) {
        const rr = 7;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
            const a = smashGrid.get(sgKey(p.x + dx * 4, p.z + dz * 4));
            if (!a) continue;
            for (const j of a) {
                const o = smashables[j];
                if (o.smashed) continue;
                const ex = o.x - p.x, ey = o.y - p.y, ez = o.z - p.z;
                if (ex * ex + ey * ey + ez * ez > rr * rr) continue;
                const l = _ps.set(ex, ey, ez).applyQuaternion(qi), h = o.s / 2;
                if (Math.abs(l.x) < 1.05 + h && l.z > -2.45 - h && l.z < 2.5 + h && l.y > -.75 - h && l.y < 1.1 + h) {
                    o.smashed = true; hits++; slow += o.bar ? .004 : .009;
                    const away = createVector(ex, 0, ez).normalize();
                    const cvx = v.x * (.8 + Math.random() * .5) + away.x * 3 + randomOffset(4), cvy = 2 + Math.random() * 6 + carSpd * .08, cvz = v.z * (.8 + Math.random() * .5) + away.z * 3 + randomOffset(4);
                    wakeSmash(o, cvx, cvy, cvz); o.vx = cvx; o.vy = cvy; o.vz = cvz;
                    o.wx = randomOffset(14); o.wy = randomOffset(14); o.wz = randomOffset(14);
                    G.smashed++; G.smashAcc += 20; G.smashN++; G.smashT = .6;
                    if (hits <= 3) sparkBurst(createVector(o.x, o.y, o.z), 5, o.bar ? 6 : 4, 8, .5, .4);
                }
            }
        }
        if (hits) { v.multiplyScalar(1 - Math.min(.12, slow)); noiseBurst(Math.min(.35, .08 + hits * .02), .2, 500 + Math.random() * 600); blip(120 + Math.random() * 60, .08, 'square', .06, .5); }
    }
    /* dynamics */
    for (let i = awakeList.length - 1; i >= 0; i--) {
        const o = awakeList[i];
        o.vy -= 22 * dt;
        o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
        o.rx += o.wx * dt; o.ry += o.wy * dt; o.rz += o.wz * dt;
        const gh = getSurfaceHeight(o.x, o.z) + o.s * .5;
        if (o.y < gh) {
            o.y = gh;
            if (o.vy < -1.2) o.vy *= -.32; else o.vy = 0;
            const f = Math.exp(-3.2 * dt); o.vx *= f; o.vz *= f; o.wx *= f; o.wy *= f; o.wz *= f;
            if (Math.abs(o.vy) < .5 && Math.hypot(o.vx, o.vz) < .9) {
                o.rest += dt;
                if (o.rest > .5) { o.awake = false; awakeList.splice(i, 1); o.rx = Math.round(o.rx / (PI / 2)) * (PI / 2) * .85 + o.rx * .15; }
            } else o.rest = 0;
        } else o.rest = 0;
        if (o.y < -20) { o.awake = false; awakeList.splice(i, 1); o.y = -999; }
        writeSmash(o); o.mesh.instanceMatrix.needsUpdate = true;
    }
    if (G.smashT > 0) { G.smashT -= dt; if (G.smashT <= 0 && G.smashN > 0) { addScore(G.smashAcc, `SMASH x${G.smashN}`, 'smash'); G.smashAcc = 0; G.smashN = 0; } }
}

/* ---------------- score tracking per frame ---------------- */
let lastZoneName = '', zoneTimer = 0, driftEmit = 0, hudTick = 1, mmTick = 1;
function updateGameplay(dt, p) {
    const s = vehicleState, spd = s.v.length();
    G.comboT = Math.max(0, G.comboT - dt);
    if (G.comboT === 0 && G.combo > 0) breakCombo();
    G.orbChainT = Math.max(0, G.orbChainT - dt);
    G.boostFx = Math.max(0, G.boostFx - dt * 1.6);
    /* drifting */
    if (s.drifting && spd > 8 && s.nc >= 3) { G.driftAcc += dt * spd * 2.4; G.driftT += dt; G.comboT = Math.max(G.comboT, 2); }
    else if (G.driftAcc > 0) { if (G.driftAcc > 140 && G.driftT > .7) addScore(G.driftAcc, 'DRIFT', 'drift'); G.driftAcc = 0; G.driftT = 0; }
    /* wall riding */
    if (s.ad > .5 && s.steep < .8 && s.nc >= 3 && spd > 8) { G.wallAcc += dt * 55; G.wallT += dt; G.comboT = Math.max(G.comboT, 2); }
    else if (G.wallAcc > 0) { if (G.wallAcc > 150 && G.wallT > 1) addScore(G.wallAcc, 'WALL RIDE', 'wall'); G.wallAcc = 0; G.wallT = 0; }
    /* checkpoints */
    for (let i = 1; i < checkpoints.length; i++) {
        const c = checkpoints[i];
        if (i === G.cp) continue;
        const fx = Math.sin(c.heading), fz = Math.cos(c.heading), rx = p.x - c.x, rz = p.z - c.z, al = rx * fx + rz * fz, la = rx * fz - rz * fx;
        if (Math.abs(al) < 7 && Math.abs(la) < 9 && p.y - getSurfaceHeight(c.x, c.z) < 9) activateCheckpoint(i);
    }
    /* zone names */
    const z = zoneAt(p.x, p.z), zn = z ? z.name : '';
    if (zn !== lastZoneName) { zoneTimer = 0; lastZoneName = zn; }
    else zoneTimer += dt;
    if (zn && G.zone !== zn && zoneTimer > .6) { G.zone = zn; popup(zn, 'zone'); }
    if (!zn) G.zone = '';
}
function scoreLanding(d, air, maxH, imp) {
    const s = vehicleState, up = createVector(0, 1, 0).applyQuaternion(s.q), clean = up.y > .3;
    const flips = Math.floor(Math.abs(s.rotPitch) / (PI * 2) + .18), rolls = Math.floor(Math.abs(s.rotRoll) / (PI * 2) + .18), spins = Math.floor(Math.abs(s.rotYaw) / (PI * 2) + .18);
    let msg = `${d | 0} m · ${air.toFixed(1)} s air`;
    let bonus = '';
    TG_HIT: for (const t of targetPads) {
        const inside = t.round ? Math.hypot(s.p.x - t.x, s.p.z - t.z) < t.r : (Math.abs(s.p.x - t.x) < t.w / 2 && Math.abs(s.p.z - t.z) < 10);
        if (inside) {
            const pts = t.round ? (Math.hypot(s.p.x - t.x, s.p.z - t.z) < 14 ? 3000 : 1500) : (t.w > 20 ? 300 : t.w > 10 ? 600 : 1200);
            bonus = `LANDED IN ${t.name} TARGET<br>`;
            if (clean) addScore(pts, t.name + ' TARGET', 'big');
            break TG_HIT;
        }
    }
    if (!clean) {
        breakCombo(); G.driftAcc = 0;
        showToast('CRASH LANDING<br>' + msg);
        return;
    }
    if (air < .9 && d < 12) { showToast(imp > 14 ? 'HARD LANDING<br>' + msg : msg); return; }
    const base = d * 3 + air * 60 + maxH * 8;
    addScore(base, `AIR ${d | 0} m`, '');
    if (flips) { const n = flips; addScore(600 * n * n, (s.rotPitch < 0 ? 'BACKFLIP' : 'FRONTFLIP') + (n > 1 ? ' x' + n : ''), 'trick'); G.tricks++; }
    if (rolls) { addScore(500 * rolls * rolls, 'BARREL ROLL' + (rolls > 1 ? ' x' + rolls : ''), 'trick'); G.tricks++; }
    if (spins) { addScore(400 * spins * spins, '360 SPIN' + (spins > 1 ? ' x' + spins : ''), 'trick'); G.tricks++; }
    if (imp < 8 && up.y > .9) addScore(150, 'SMOOTH LANDING', 'small');
    showToast(bonus + (imp > 14 ? 'HARD LANDING<br>' : '') + msg);
}

/* ---------------- minimap ---------------- */
const MM = { c: getElement('minimap'), x0: -345, x1: 345, z0: -290, z1: 870, S: 1, last: 0 };
let mmStatic = null;
if (MM.c) {
    MM.ctx = MM.c.getContext('2d');
    const W = (MM.x1 - MM.x0) * MM.S, Hh = (MM.z1 - MM.z0) * MM.S, sc = document.createElement('canvas');
    sc.width = W; sc.height = Hh;
    const g = sc.getContext('2d'), X = x => (x - MM.x0) * MM.S, Y = z => (MM.z1 - z) * MM.S;
    g.fillStyle = '#04080e'; g.fillRect(0, 0, W, Hh);
    g.strokeStyle = 'rgba(120,100,220,.14)'; g.lineWidth = 1;
    for (let x = Math.ceil(MM.x0 / 100) * 100; x < MM.x1; x += 100) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), Hh); g.stroke(); }
    for (let z = Math.ceil(MM.z0 / 100) * 100; z < MM.z1; z += 100) { g.beginPath(); g.moveTo(0, Y(z)); g.lineTo(W, Y(z)); g.stroke(); }
    g.strokeStyle = 'rgba(190,180,255,.28)'; g.lineWidth = 7; g.lineCap = 'butt';
    [[0, -100, 0, 560, 22], [-310, -85, 330, -85, 18], [132, -85, 132, -50, 16], [205, -85, 205, 10, 16], [-60, -85, -60, 0, 14], [60, -85, 60, -40, 14], [-230, -85, -230, 46, 14], [-85, 175, 0, 175, 12], [-85, 175, -85, 192, 12], [12, 274, 150, 274, 12]].forEach(r => { g.lineWidth = Math.max(3, r[4] * .55); g.beginPath(); g.moveTo(X(r[0]), Y(r[1])); g.lineTo(X(r[2]), Y(r[3])); g.stroke(); });
    zoneRects.forEach(z => { g.fillStyle = z.col + '24'; g.fillRect(X(z.x0), Y(z.z1), (z.x1 - z.x0) * MM.S, (z.z1 - z.z0) * MM.S); g.strokeStyle = z.col + '99'; g.lineWidth = 1.5; g.strokeRect(X(z.x0), Y(z.z1), (z.x1 - z.x0) * MM.S, (z.z1 - z.z0) * MM.S); });
    heightRegions.forEach(r => {
        const hc = r.f((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
        if (hc < 1 && (r.x1 - r.x0) > 60) return;
        g.fillStyle = 'rgba(210,205,255,.30)';
        g.fillRect(X(r.x0), Y(r.z1), (r.x1 - r.x0) * MM.S, (r.z1 - r.z0) * MM.S);
    });
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = 'bold 11px Helvetica, Arial, sans-serif'; g.textAlign = 'center';
    zoneRects.forEach(z => g.fillText(z.name, X((z.x0 + z.x1) / 2), Y((z.z0 + z.z1) / 2)));
    mmStatic = sc;
}
function drawMinimap(p, heading) {
    if (!MM.ctx || !mmStatic) return;
    const c = MM.ctx, size = MM.c.width, R = 190, sx = p.x, sz = p.z, k = size / (R * 2);
    c.clearRect(0, 0, size, size);
    c.save();
    c.beginPath(); c.arc(size / 2, size / 2, size / 2 - 1, 0, 6.3); c.clip();
    c.fillStyle = '#04080e'; c.fillRect(0, 0, size, size);
    const px = (sx - MM.x0) * MM.S, py = (MM.z1 - sz) * MM.S;
    c.drawImage(mmStatic, px - R * MM.S, py - R * MM.S, R * 2 * MM.S, R * 2 * MM.S, 0, 0, size, size);
    const W = (x, z) => [(x - sx) * k + size / 2, (sz - z) * k + size / 2];
    c.fillStyle = '#7fe6ff';
    for (let i = 0; i < orbCount; i++) { if (orbCollected[i]) continue; const o = orbSpawns[i]; if (Math.abs(o[0] - sx) > R || Math.abs(o[2] - sz) > R) continue; const [x, y] = W(o[0], o[2]); c.fillRect(x - 1, y - 1, 2.4, 2.4); }
    c.strokeStyle = '#4fd8ff'; c.lineWidth = 1.5;
    hoops.forEach(q => { if (q.done) return; const [x, y] = W(q.h.x, q.h.z); if (x < -4 || y < -4 || x > size + 4 || y > size + 4) return; c.beginPath(); c.arc(x, y, 3, 0, 6.3); c.stroke(); });
    checkpoints.forEach((cp, i) => { const [x, y] = W(cp.x, cp.z); c.fillStyle = i === G.cp ? '#52ff8a' : '#fff'; c.beginPath(); c.moveTo(x, y - 4); c.lineTo(x + 3.5, y); c.lineTo(x, y + 4); c.lineTo(x - 3.5, y); c.closePath(); c.fill(); });
    c.restore();
    c.save(); c.translate(size / 2, size / 2); c.rotate(heading);
    c.fillStyle = '#ffb02e'; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -8); c.lineTo(5.5, 6); c.lineTo(0, 3); c.lineTo(-5.5, 6); c.closePath(); c.fill(); c.stroke();
    c.restore();
    c.strokeStyle = 'rgba(190,180,255,.45)'; c.lineWidth = 2; c.beginPath(); c.arc(size / 2, size / 2, size / 2 - 1, 0, 6.3); c.stroke();
}
function updateHUD() {
    const sc = getElement('score-val'); if (!sc) return;
    sc.textContent = fmt(G.score);
    getElement('best-val').textContent = fmt(G.best);
    getElement('orb-val').textContent = G.orbs + '/' + orbCount;
    getElement('hoop-val').textContent = G.hoops + '/' + hoops.length;
    getElement('smash-val').textContent = G.smashed;
    const cb = getElement('combo');
    cb.classList.toggle('on', G.mult > 1 || G.combo > 0);
    getElement('combo-x').textContent = 'x' + G.mult;
    getElement('combo-bar').style.width = (G.comboT / 5 * 100) + '%';
}
setInterval(() => { if (G.score > 0) saveBest(); }, 5000);

/* ---------- mode toggles ---------- */
let gameRunning = false;
function setThrusterMode(t) {
    if (t)
        vehicleState.auto = !vehicleState.auto;
    const chip = getElement('mode-status');
    chip.textContent = vehicleState.auto ? 'AUTO' : 'MANUAL';
    chip.className = 'm' + (vehicleState.auto ? '' : ' man');
    const mobileModeButton = getElement('mobile-mode');
    if (mobileModeButton) {
        mobileModeButton.textContent = vehicleState.auto ? 'AUTO' : 'MANUAL';
        mobileModeButton.classList.toggle('active', vehicleState.auto);
        mobileModeButton.setAttribute('aria-pressed', String(vehicleState.auto));
    }
    if (t)
        showToast(vehicleState.auto ? 'AUTO · landing assist' : 'MANUAL · direct thruster control');
}
getElement('mode-status').addEventListener('click', () => setThrusterMode(1));
function toggleWallGrip() {
    wallGripEnabled = !wallGripEnabled;
    if (!wallGripEnabled) {
        inputKeys.Shift = 0;
    }
    const gripButton = getElement('mobile-grip');
    if (gripButton) {
        gripButton.classList.toggle('active', wallGripEnabled);
        gripButton.textContent = wallGripEnabled ? 'GRIP ON' : 'GRIP OFF';
        gripButton.setAttribute('aria-pressed', String(wallGripEnabled));
    }
    showToast(wallGripEnabled ? 'WALL GRIP ENABLED' : 'WALL GRIP RELEASED');
}

addEventListener('keydown', e => {
    if (e.code === 'Escape') {
        if (!detailsPanel.hidden) {
            setDetailsOpen(false);
            return;
        }
        gameRunning = !gameRunning;
        getElement('ov').style.display = gameRunning ? 'none' : 'flex';
        document.body.classList.toggle('game-running', gameRunning);
        return;
    }
    if (!gameRunning)
        return;
    if (KM[e.code]) {
        inputKeys[KM[e.code]] = 1;
        e.preventDefault();
    }
    if (e.code === 'KeyR')
        respawn();
    if (e.code === 'KeyT')
        respawn(0);
    if (e.code === 'KeyM')
        setThrusterMode(1);
    if (e.code === 'KeyG' && !e.repeat)
        toggleWallGrip();
    if (e.code === 'KeyH')
        setDetailsOpen(detailsPanel.hidden);
});
addEventListener('keyup', e => {
    if (KM[e.code])
        inputKeys[KM[e.code]] = 0;
});
addEventListener('blur', () => {
    for (const x in inputKeys)
        inputKeys[x] = 0;
});
getElement('go').onclick = () => {
    gameRunning = true;
    getElement('ov').style.display = 'none';
    document.body.classList.add('game-running');
    initSound();
};
const detailsPanel = getElement('details-panel');
const detailsToggle = getElement('details-toggle');
function setDetailsOpen(open) {
    detailsPanel.hidden = !open;
    detailsToggle.setAttribute('aria-expanded', String(open));
}
detailsToggle.addEventListener('click', () => setDetailsOpen(detailsPanel.hidden));
getElement('details-close').addEventListener('click', () => setDetailsOpen(false));



const soundState = {
    enabled: true,
    context: null,
    master: null,
    engineGain: null,
    engineFilter: null,
    engineA: null,
    engineB: null,
    thrusterGain: null,
    tireGain: null,
    noiseBuffer: null,
    compressor: null,
    started: false,
    startupPlayed: false
};



function isLocalAudioReady(audioElement) {
    return audioElement.dataset.unavailable !== "true"
        && audioElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
}

function playLocalAudio(audioElement, volume = 0.8) {
    if (!soundState.enabled || !isLocalAudioReady(audioElement)) return false;
    audioElement.volume = clamp(volume, 0, 1);
    try { audioElement.currentTime = 0; } catch (_) { /* Metadata may still be settling. */ }
    audioElement.play().catch(() => {
        audioElement.dataset.unavailable = "true";
    });
    return true;
}

function updateLocalLoopAudio(audioElement, shouldPlay, volume) {
    if (!isLocalAudioReady(audioElement)) {
        if (!audioElement.paused) audioElement.pause();
        return false;
    }
    audioElement.volume = clamp(volume, 0, 1);
    if (soundState.enabled && shouldPlay) {
        if (audioElement.paused) {
            audioElement.play().catch(() => {
                audioElement.dataset.unavailable = "true";
            });
        }
    } else if (!audioElement.paused) {
        audioElement.pause();
    }
    return true;
}


function initSound() {

    if (soundState.context) {
        if (soundState.context.state === 'suspended')
            soundState.context.resume().catch(() => { });
        return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass)
        return;
    const ctx = new AudioContextClass();
    soundState.context = ctx;
    const master = ctx.createGain();
    master.gain.value = soundState.enabled ? 0.68 : 0;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 7;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;
    master.connect(compressor);
    compressor.connect(ctx.destination);
    soundState.master = master;
    soundState.compressor = compressor;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 180;
    engineFilter.Q.value = 0.7;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    const engineA = ctx.createOscillator();
    engineA.type = 'sawtooth';
    engineA.frequency.value = 48;
    engineA.connect(engineFilter);
    engineA.start();
    const engineB = ctx.createOscillator();
    engineB.type = 'triangle';
    engineB.frequency.value = 72;
    const engineBGain = ctx.createGain();
    engineBGain.gain.value = 0.3;
    engineB.connect(engineBGain);
    engineBGain.connect(engineFilter);
    engineB.start();
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    soundState.noiseBuffer = noiseBuffer;
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++)
        channel[i] = Math.random() * 2 - 1;
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    const thrusterFilter = ctx.createBiquadFilter();
    thrusterFilter.type = 'lowpass';
    thrusterFilter.frequency.value = 620;
    const thrusterGain = ctx.createGain();
    thrusterGain.gain.value = 0;
    noiseSource.connect(thrusterFilter);
    thrusterFilter.connect(thrusterGain);
    thrusterGain.connect(master);
    noiseSource.start();
    const tireSource = ctx.createBufferSource();
    tireSource.buffer = noiseBuffer;
    tireSource.loop = true;
    const tireFilter = ctx.createBiquadFilter();
    tireFilter.type = 'bandpass';
    tireFilter.frequency.value = 1350;
    tireFilter.Q.value = 0.7;
    const tireGain = ctx.createGain();
    tireGain.gain.value = 0;
    tireSource.connect(tireFilter);
    tireFilter.connect(tireGain);
    tireGain.connect(master);
    tireSource.start();
    soundState.engineFilter = engineFilter;
    soundState.engineGain = engineGain;
    soundState.engineA = engineA;
    soundState.engineB = engineB;
    soundState.thrusterGain = thrusterGain;
    soundState.tireGain = tireGain;
    soundState.started = true;
    ctx.resume().catch(() => { });
}
function toggleSound() {
    soundState.enabled = !soundState.enabled;
    if (soundState.context && soundState.master) {
        soundState.master.gain.setTargetAtTime(soundState.enabled ? 0.68 : 0, soundState.context.currentTime, 0.05);
        if (soundState.enabled && soundState.context.state === 'suspended')
            soundState.context.resume().catch(() => { });
    }
    const button = getElement('sound-toggle');
    button.textContent = soundState.enabled ? '♫' : '×';
    button.title = soundState.enabled ? 'Mute game sounds' : 'Enable game sounds';
    button.setAttribute('aria-label', soundState.enabled ? 'Mute game sounds' : 'Enable game sounds');
    button.setAttribute('aria-pressed', String(soundState.enabled));
    if (soundState.enabled && gameRunning)
        initSound();
}
getElement('sound-toggle').addEventListener('click', toggleSound);
function playLandingImpact(impactSpeed) {
    const ctx = soundState.context;
    if (!ctx || !soundState.enabled)
        return;
    const now = ctx.currentTime;
    const intensity = Math.max(0, Math.min(1, (impactSpeed - 1.5) / 17));
    if (intensity < 0.04)
        return;

    // Fallback: layered suspension compression and chassis clunk when the MP3 is absent.
    // Punchy sub-bass thump: the part that makes a hit feel heavy rather than a beep.
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(58 + intensity * 14, now);
    thump.frequency.exponentialRampToValueAtTime(22, now + 0.1);
    thumpGain.gain.setValueAtTime(0.001, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.4 + intensity * 0.55, now + 0.008);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    thump.connect(thumpGain);
    thumpGain.connect(soundState.master);
    thump.start(now);
    thump.stop(now + 0.24);
    const low = ctx.createOscillator();
    const lowGain = ctx.createGain();
    low.type = 'sine';
    low.frequency.setValueAtTime(62 + intensity * 22, now);
    low.frequency.exponentialRampToValueAtTime(27, now + 0.26);
    lowGain.gain.setValueAtTime(0.24 + intensity * 0.42, now);
    lowGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    low.connect(lowGain);
    lowGain.connect(soundState.master);
    low.start(now);
    low.stop(now + 0.31);
    const clunk = ctx.createOscillator();
    const clunkGain = ctx.createGain();
    const clunkFilter = ctx.createBiquadFilter();
    clunk.type = 'triangle';
    clunk.frequency.setValueAtTime(170 + intensity * 90, now);
    clunk.frequency.exponentialRampToValueAtTime(68, now + 0.08);
    clunkFilter.type = 'lowpass';
    clunkFilter.frequency.setValueAtTime(1100, now);
    clunkFilter.frequency.exponentialRampToValueAtTime(220, now + 0.13);
    clunkGain.gain.setValueAtTime(0.16 + intensity * 0.34, now);
    clunkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    clunk.connect(clunkFilter);
    clunkFilter.connect(clunkGain);
    clunkGain.connect(soundState.master);
    clunk.start(now);
    clunk.stop(now + 0.17);
    // A brief filtered noise crunch gives the hit grit and weight instead of a clean tone.
    if (soundState.noiseBuffer) {
        const noise = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const noiseGain = ctx.createGain();
        noise.buffer = soundState.noiseBuffer;
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(260 + intensity * 300, now);
        filter.Q.value = 0.6;
        noiseGain.gain.setValueAtTime(0.1 + intensity * 0.26, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(soundState.master);
        noise.start(now);
        noise.stop(now + 0.14);
    }
}
function updateSound(speed) {
    const ctx = soundState.context;
    if (!ctx || !soundState.started)
        return;
    const now = ctx.currentTime;
    const bodyForward = createVector(0, 0, 1).applyQuaternion(vehicleState.q);
    const bodyRight = createVector(1, 0, 0).applyQuaternion(vehicleState.q);
    const lateralSpeed = Math.abs(vehicleState.v.dot(bodyRight));
    const enginePitch = 46 + Math.min(speed, 95) * 1.42 + (inputKeys.W ? 10 : 0);
    soundState.engineA.frequency.setTargetAtTime(enginePitch, now, 0.08);
    soundState.engineB.frequency.setTargetAtTime(enginePitch * 1.48, now, 0.08);
    soundState.engineFilter.frequency.setTargetAtTime(130 + Math.min(speed, 100) * 2.2, now, 0.08);
    soundState.engineGain.gain.setTargetAtTime(soundState.enabled ? 0.055 + Math.min(speed / 100, 1) * 0.085 : 0, now, 0.12);
    const thrustAmount = Math.max(vehicleState.tl, ...thrusters.slice(0, 8).map(t => t.l * 0.55));

    const proceduralThrusterVolume = soundState.enabled
        ? Math.min(0.30, thrustAmount * 0.24)
        : 0;
    soundState.thrusterGain.gain.setTargetAtTime(proceduralThrusterVolume, now, 0.045);
    soundState.tireGain.gain.setTargetAtTime(soundState.enabled && vehicleState.drifting && speed > 6 ? Math.min(0.30, Math.max(0, lateralSpeed - 0.8) * 0.022) : 0, now, 0.06);
}
/* ---------- virtual mobile controls ---------- */
const joystick = getElement('mobile-joystick');
const joystickKnob = getElement('joystick-knob');
let joystickPointerId = null;
function setDriveAxes(x, y) {
    const dead = 0.22;
    inputKeys.A = x < -dead;
    inputKeys.D = x > dead;
    inputKeys.W = y < -dead;
    inputKeys.S = y > dead;
}
function resetJoystick() {
    joystickPointerId = null;
    setDriveAxes(0, 0);
    joystickKnob.style.left = '50%';
    joystickKnob.style.top = '50%';
}
function moveJoystick(e) {
    const rect = joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = Math.min(rect.width, rect.height) * 0.34;
    let dx = (e.clientX - cx) / radius;
    let dy = (e.clientY - cy) / radius;
    const length = Math.hypot(dx, dy);
    if (length > 1) {
        dx /= length;
        dy /= length;
    }
    setDriveAxes(dx, dy);
    joystickKnob.style.left = `${50 + dx * 34}%`;
    joystickKnob.style.top = `${50 + dy * 34}%`;
}
joystick.addEventListener('pointerdown', e => {
    if (!gameRunning || joystickPointerId !== null)
        return;
    joystickPointerId = e.pointerId;
    joystick.setPointerCapture(e.pointerId);
    moveJoystick(e);
    e.preventDefault();
});
joystick.addEventListener('pointermove', e => {
    if (e.pointerId !== joystickPointerId)
        return;
    moveJoystick(e);
    e.preventDefault();
});
function endJoystick(e) {
    if (joystickPointerId === null || (e && e.pointerId !== undefined && e.pointerId !== joystickPointerId))
        return;
    resetJoystick();
}
joystick.addEventListener('pointerup', endJoystick);
joystick.addEventListener('pointercancel', endJoystick);
joystick.addEventListener('lostpointercapture', endJoystick);
document.querySelectorAll('[data-hold-key]').forEach(button => {
    const keyName = button.dataset.holdKey;
    const press = e => {
        if (!gameRunning)
            return;
        inputKeys[keyName] = true;
        button.classList.add('pressed');
        e.preventDefault();
    };
    const release = e => {
        inputKeys[keyName] = false;
        button.classList.remove('pressed');
        if (e)
            e.preventDefault();
    };
    button.addEventListener('pointerdown', e => {
        if (button.setPointerCapture)
            button.setPointerCapture(e.pointerId);
        press(e);
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', e => e.preventDefault());
});
getElement('mobile-grip').addEventListener('click', toggleWallGrip);
getElement('mobile-mode').addEventListener('click', () => setThrusterMode(1));
getElement('mobile-reset').addEventListener('click', () => respawn());
addEventListener('blur', () => {
    resetJoystick();
    document.querySelectorAll('[data-hold-key]').forEach(button => {
        inputKeys[button.dataset.holdKey] = false;
        button.classList.remove('pressed');
    });
});

/* ---------- render loop ---------- */
let cameraHeading = 0, previousFrameTime = performance.now(), simulationAccumulator = 0;
const prevP = vehicleState.p.clone(), prevQ = vehicleState.q.clone();
const mobileView = matchMedia('(max-width: 760px), (pointer: coarse)');
let camOff = null, lookOff = null, camAnchorY = null, camFov = 62, camRoll = 0, lastCamP = null, shakeT = 0, speedFx = 0;
const camUp = createVector(0, 1, 0);
let lastAlong = 0, accelS = 0, brakeAmt = 0;
/* Mouse-look: orbit while dragging, hold the view briefly after release, then ease back. */
let mouseLookActive = false;
let mouseLookPointerId = null;
let mouseLookYaw = 0;
let mouseLookPitch = 0;
let mouseLastX = 0;
let mouseLastY = 0;
let cameraLookTarget = null;
let mouseLookHold = false;
let mouseReturnDelay = 0;
let mouseReturnProgress = 1;
const MOUSE_RETURN_DELAY = 3.5;
const MOUSE_RETURN_DURATION = 2.0;
renderer.domElement.style.cursor = 'grab';
renderer.domElement.addEventListener('pointerdown', e => {
    if (!gameRunning || e.button !== 0)
        return;
    mouseLookActive = true;
    mouseLookHold = false;
    mouseReturnDelay = 0;
    mouseReturnProgress = 0;
    mouseLookPointerId = e.pointerId;
    mouseLookYaw = 0;
    mouseLookPitch = 0;
    mouseLastX = e.clientX;
    mouseLastY = e.clientY;
    if (renderer.domElement.setPointerCapture)
        renderer.domElement.setPointerCapture(e.pointerId);
    renderer.domElement.style.cursor = 'grabbing';
    e.preventDefault();
});
renderer.domElement.addEventListener('pointermove', e => {
    if (!mouseLookActive || e.pointerId !== mouseLookPointerId)
        return;
    const dx = e.clientX - mouseLastX;
    const dy = e.clientY - mouseLastY;
    mouseLastX = e.clientX;
    mouseLastY = e.clientY;
    mouseLookYaw -= dx * 0.006;
    mouseLookPitch = clamp(mouseLookPitch + dy * 0.005, -0.95, 0.9);
});
function stopMouseLook(e) {
    if (!mouseLookActive)
        return;
    if (e && mouseLookPointerId !== null && e.pointerId !== undefined && e.pointerId !== mouseLookPointerId)
        return;
    const pointerId = mouseLookPointerId;
    mouseLookActive = false;
    mouseLookHold = true;
    mouseReturnDelay = MOUSE_RETURN_DELAY;
    mouseReturnProgress = 0;
    mouseLookPointerId = null;
    renderer.domElement.style.cursor = 'grab';
    if (pointerId !== null && renderer.domElement.hasPointerCapture && renderer.domElement.hasPointerCapture(pointerId)) {
        renderer.domElement.releasePointerCapture(pointerId);
    }
}
renderer.domElement.addEventListener('pointerup', stopMouseLook);
renderer.domElement.addEventListener('pointercancel', stopMouseLook);
addEventListener('blur', () => stopMouseLook());
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
/* ---- post: scene (HDR, 4x MSAA) -> bloom -> chromatic speed blur, ACES, vignette, gamma, grain ---- */
let composer = null, bloomPass = null, fxPass = null, perfT = 1 / 60, qTier = 0;
try {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE_NS.NoToneMapping;
    const scenePass = pass(scene, camera), sceneTex = scenePass.getTextureNode('output');
    bloomPass = bloom(sceneTex, .32, .5, .92);
    fxPass = { uniforms: { time: uniform(0), speed: uniform(0) } };
    const { time: fxTime, speed: fxSpeed } = fxPass.uniforms;
    const aces = x => tslClamp(x.mul(x.mul(2.51).add(.03)).div(x.mul(x.mul(2.43).add(.59)).add(.14)), 0, 1);
    const makeFx = bloomTex => Fn(() => {
        const vUv = uv(), d = vUv.sub(.5), r = dot(d, d);
        const src = q => bloomTex ? sceneTex.sample(q).add(bloomTex.sample(q)) : sceneTex.sample(q);
        const ca = d.mul(r).mul(fxSpeed.add(.3).mul(.004));
        let c = vec3(0);
        for (let i = 0; i < 5; i++) {
            const q = vUv.sub(d.mul(fxSpeed.mul(.018 * i)));
            c = c.add(vec3(src(q.add(ca)).r, src(q).g, src(q.sub(ca)).b));
        }
        const col = aces(c.div(5).mul(1.25)).mul(smoothstep(.08, .5, r).mul(.55).oneMinus()).pow(vec3(1 / 2.2)).toVar();
        col.addAssign(fract(sin(dot(vUv.mul(vec2(1731, 911)).add(fxTime), vec2(12.9898, 78.233))).mul(43758.5453)).sub(.5).mul(.02));
        return vec4(col, 1);
    })();
    composer = new THREE_NS.RenderPipeline(renderer);
    composer.outputColorTransform = false;   /* the fx pass does its own tone mapping + gamma */
    composer.outputNode = makeFx(bloomPass.getTextureNode());
    composer.disableBloom = () => { composer.outputNode = makeFx(null); composer.needsUpdate = true; };
} catch (err) { console.error(err); composer = null; renderer.toneMapping = THREE_NS.ACESFilmicToneMapping; }

/* ---- bloom controls: small floating panel, press B to toggle ---- */
if (bloomPass) {
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9999;background:rgba(8,8,10,.82);border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:10px 12px;font:12px/1.4 system-ui,sans-serif;color:#eee;display:none;min-width:190px;backdrop-filter:blur(6px)';
    const row = (label, node, min, max, step) => {
        const r = document.createElement('div'); r.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0';
        const l = document.createElement('span'); l.textContent = label; l.style.cssText = 'width:62px;opacity:.85';
        const v = document.createElement('span'); v.style.cssText = 'width:36px;text-align:right;opacity:.6;font-variant-numeric:tabular-nums';
        const s = document.createElement('input'); s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = node.value;
        s.oninput = () => { node.value = +s.value; v.textContent = (+s.value).toFixed(2); };
        v.textContent = (+s.value).toFixed(2);
        r.append(l, s, v); panel.appendChild(r);
    };
    const title = document.createElement('div'); title.textContent = 'BLOOM (B to hide)'; title.style.cssText = 'opacity:.6;margin-bottom:4px;letter-spacing:.04em';
    panel.appendChild(title);
    row('Strength', bloomPass.strength, 0, 1.5, .01);
    row('Radius', bloomPass.radius, 0, 1, .01);
    row('Threshold', bloomPass.threshold, 0, 1.5, .01);
    document.body.appendChild(panel);
    addEventListener('keydown', e => { if (e.code === 'KeyB' && !e.repeat) panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
}
function resizeRenderer() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
addEventListener('resize', resizeRenderer);
resizeRenderer();
function renderFrame(dt) {
    const { v } = vehicleState, spd = v.length();
    const al = gameRunning ? Math.min(1, simulationAccumulator * 120) : 1;
    const jumped = prevP.distanceToSquared(vehicleState.p) > 36;
    const p = jumped ? vehicleState.p.clone() : prevP.clone().lerp(vehicleState.p, al);
    const q = jumped ? vehicleState.q.clone() : prevQ.clone().slerp(vehicleState.q, al);
    const fw = createVector(0, 0, 1).applyQuaternion(q);
    updateSound(spd);
    rig.position.copy(p);
    rig.quaternion.copy(q);
    vehicleState.sp += v.dot(fw) * dt / .36;
    WV.forEach(([g, f]) => {
        g.rotation.x = vehicleState.sp;
        g.rotation.y = f ? vehicleState.steer : 0;
    });
    vehicleState.wo += ((spd > 30 || vehicleState.tl > .1 ? 1 : 0) - vehicleState.wo) * Math.min(1, dt * 3);
    if (wing) {
        wing.position.y = wingBaseY + vehicleState.wo * .1;
        wing.rotation.x = -vehicleState.wo * .08;
    }
    glow.intensity = 2.6 * vehicleState.tl;
    contactBlob.material.opacity = Math.max(0, 1 - vehicleState.air / .35) * .8;
    key.position.copy(p).addScaledVector(lightDir, 110);
    key.target.position.copy(p);
    key.target.updateMatrixWorld();
    thrusters.forEach(t => {
        if (t.l > .08) {
            const big = t.m > 10000, lv = Math.min(1, t.l), sc = big ? 1 : t.m > 6000 ? .7 : .55;
            t.ea = (t.ea || 0) + dt * (big ? 120 : 55) * lv;
            t.sa = (t.sa || 0) + dt * (big ? 70 : 34) * lv;
            const ex = t.d.clone().applyQuaternion(q).multiplyScalar(-1);
            const nozzle = () => p.clone().add(t.r.clone().add(createVector(randomOffset(.12 * sc), randomOffset(.12 * sc), randomOffset(.12 * sc))).applyQuaternion(q));
            while (t.ea >= 1) {
                t.ea--;
                emitParticle(nozzle(), ex.clone().multiplyScalar((big ? 19 : 12) * (.85 + Math.random() * .3)).addScaledVector(v, .55)
                    .add(createVector(randomOffset(1.1), randomOffset(1.1), randomOffset(1.1))), .2 + Math.random() * .2, 0, sc);
            }
            while (t.sa >= 1) {
                t.sa--;
                emitParticle(nozzle(), ex.clone().multiplyScalar((big ? 4.5 : 3) * (.5 + Math.random() * .5)).addScaledVector(v, .42)
                    .add(createVector(randomOffset(1.6), randomOffset(1) + .7, randomOffset(1.6))), 2.4 + Math.random() * 1.8, 2, sc, 1 + ((Math.random() * 3) | 0));
            }
        }
        else { t.ea = t.sa = 0; }
    });
    if (gameRunning && vehicleState.drifting && spd > 8 && vehicleState.nc >= 3) {
        driftEmit += dt * 105;
        while (driftEmit >= 1) { driftEmit--; [-1, 1].forEach(sd => emitParticle(p.clone().add(createVector(sd * .98, -.25, -1.35).applyQuaternion(q)), createVector(randomOffset(1.5), .6 + Math.random() * .8, randomOffset(1.5)).addScaledVector(v, .25), 1.8 + Math.random() * 1.0, 2, .6, 1 + ((Math.random() * 3) | 0))); }
    } else driftEmit = 0;
    const lerpc = (a, b, k) => a + (b - a) * k;
    const smoothstepJS = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const o = i * 3;
        if (particleAges[i] >= particleLifetimes[i]) { particleAlphas[i] = 0; particleSizes[i] = 0; continue; }
        particleAges[i] += dt;
        const t = Math.min(1, particleAges[i] / particleLifetimes[i]), f = 1 - t, kind = particleKinds[i], base = particleBase[i];
        const seed = particleRotSeed[i];
        const dr = 1 - (kind === 0 ? 2.4 : kind === 2 ? .55 + t * 1.5 : 1.7) * dt;
        particleVelocities[o] *= dr;
        particleVelocities[o + 1] *= dr;
        particleVelocities[o + 2] *= dr;
        if (kind === 2) {
            /* buoyancy: rises fast while hot, slows and spreads as it cools */
            particleVelocities[o + 1] += (2.6 * f * f + .25) * dt;
            /* curl-ish turbulence: cheap sine drift so puffs billow sideways instead of drifting in a straight line */
            const age = particleAges[i];
            particleVelocities[o] += Math.sin(age * 1.7 + seed) * 1.4 * dt;
            particleVelocities[o + 1] += Math.sin(age * 1.3 + seed * 1.7) * .5 * dt;
            particleVelocities[o + 2] += Math.cos(age * 1.5 + seed * 2.3) * 1.4 * dt;
        }
        else if (kind >= 3) particleVelocities[o + 1] -= 14 * dt;
        particlePositions[o] += particleVelocities[o] * dt;
        particlePositions[o + 1] += particleVelocities[o + 1] * dt;
        particlePositions[o + 2] += particleVelocities[o + 2] * dt;
        particleRots[i] = seed + particleAges[i] * (kind === 0 ? .8 : kind === 2 ? .12 + .3 * (seed % 1) : .35);
        if (kind === 0) {
            /* flame: white-blue core -> orange -> deep red, shrinking */
            let r, g, b;
            if (t < .3) { const k = t / .3; r = lerpc(3.4, 1.6, k); g = lerpc(3.8, 2.2, k); b = lerpc(4.4, 3.4, k); }
            else { const k = (t - .3) / .7; r = lerpc(1.6, .25, k); g = lerpc(2.2, .55, k); b = lerpc(3.4, 1.1, k); }
            particleColors[o] = r * f; particleColors[o + 1] = g * f; particleColors[o + 2] = b * f;
            particleAlphas[i] = .1 * f;
            particleSizes[i] = base * (1.15 * (1 - .5 * t) + .1);
        }
        else if (kind === 2) {
            /* smoke: hot and faintly warm at the nozzle, cooling to grey-blue and thinning as it disperses */
            const warm = Math.max(0, 1 - t / .14);
            const tone = .55 + .4 * Math.sin(seed * 7.3 + 1);           /* per-puff shade variance, avoids flat uniform grey */
            const cool = lerpc(.22, .34, Math.sin(seed * 3.1) * .5 + .5); /* slight per-puff grey-blue drift */
            const sh = (.32 + .3 * f) * tone;
            particleColors[o] = sh * .92 + warm * .22;
            particleColors[o + 1] = sh * .97 + warm * .4;
            particleColors[o + 2] = sh * (.97 + cool) + warm * .5;
            const alphaVar = .75 + .5 * (Math.sin(seed * 5.2) * .5 + .5);
            particleAlphas[i] = smoothstepJS(0, .1, t) * Math.pow(f, 1.1) * .58 * alphaVar;
            particleSizes[i] = base * (.9 + 4.6 * Math.sqrt(t)) * (.85 + .3 * (Math.sin(seed * 2.1) * .5 + .5));
        }
        else if (kind >= 3) {
            const pal = kind === 3 ? [3.2, 2.6, 1.5] : kind === 4 ? [2.6, 2.8, 3.4] : kind === 5 ? [.8, 2.4, 3.2] : [3.2, 1.1, .3];
            particleColors[o] = pal[0] * f; particleColors[o + 1] = pal[1] * f; particleColors[o + 2] = pal[2] * f;
            particleAlphas[i] = .6 * f;
            particleSizes[i] = base * (.5 + .6 * f);
        }
        else {
            /* dust */
            particleColors[o] = .2 * f + .05; particleColors[o + 1] = .21 * f + .05; particleColors[o + 2] = .24 * f + .06;
            particleAlphas[i] = Math.min(1, t * 8) * f * .4;
            particleSizes[i] = .7 + 2.6 * t;
        }
    }
    pg.attributes.position.needsUpdate = pg.attributes.color.needsUpdate = pg.attributes.aSize.needsUpdate = pg.attributes.aAlpha.needsUpdate = pg.attributes.aRot.needsUpdate = pg.attributes.aVar.needsUpdate = true;
    {
        const tNow = performance.now() * .001, vp = vehicleState.p;
        skyTime.value = tNow; padUniform.time.value = tNow;
        updateOrbs(tNow, vp); updateHoops(tNow, vp);
        if (gameRunning) { updateGameplay(dt, vp); updateSmashables(dt); }
        if ((hudTick += dt) > .1) { hudTick = 0; updateHUD(); }
        if ((mmTick += dt) > .066) { mmTick = 0; drawMinimap(vp, Math.atan2(fw.x, fw.z)); }
    }
    /* ---- cinematic chase camera: smoothing happens in car-relative space, so there is no speed-dependent lag ---- */
    if (!window.__freezeCam) {
    if (lastCamP && lastCamP.distanceToSquared(p) > 36) { camOff = lookOff = camAnchorY = cameraLookTarget = null; cameraHeading = Math.atan2(fw.x, fw.z); camUp.set(0, 1, 0); }
    lastCamP = p.clone();
    camAnchorY = camAnchorY === null ? p.y : camAnchorY + (p.y - camAnchorY) * (1 - Math.exp(-10 * dt));
    const fh = Math.atan2(fw.x, fw.z), vh = Math.atan2(v.x, v.z), fl = Math.hypot(fw.x, fw.z);
    let th = fl > .4 ? fh : (spd > 3 ? vh : cameraHeading);
    if (fl > .4 && spd > 5 && v.dot(fw) > -1)
        th = fh + Math.atan2(Math.sin(vh - fh), Math.cos(vh - fh)) * Math.min(1, (spd - 5) / 20) * .7;
    let df = th - cameraHeading;
    df = Math.atan2(Math.sin(df), Math.cos(df));
    cameraHeading += df * (1 - Math.exp(-(spd > 8 ? 3.4 : 2.2) * dt));
    const dir = createVector(Math.sin(cameraHeading), 0, Math.cos(cameraHeading));
    const tdx = p.x - TUNNEL.x, tdy = p.y - TUNNEL.y, tR = Math.hypot(tdx, tdy);
    const inTunnel = p.z > TUNNEL.z0 && p.z < TUNNEL.z1 && tR < TUNNEL.radius + 1.8;
    const wantUp = inTunnel && tR > 4 && vehicleState.air < .4 ? createVector(0, 1, 0).applyQuaternion(q) : createVector(0, 1, 0);
    camUp.lerp(wantUp, 1 - Math.exp(-4 * dt)).normalize();
    const sp = Math.min(spd / 60, 1.4);
    const alongV = v.dot(fw);
    accelS += (clamp((alongV - lastAlong) / Math.max(dt, .001), -40, 40) - accelS) * (1 - Math.exp(-5 * dt));
    lastAlong = alongV;
    brakeAmt += ((accelS < -2.5 ? 1 : 0) - brakeAmt) * (1 - Math.exp(-14 * dt));
    updateCarLights(brakeAmt, !!inputKeys.S && alongV < -.8);
    const phoneCam = mobileView.matches;   /* narrow portrait screens: pull the chase camera back so the car doesn't fill the frame */
    const dist = (5.7 + sp * 1.5 + vehicleState.tl * .9 + clamp(accelS * .035, -.6, 1)) * (phoneCam ? 1.35 : 1);
    const hgt = Math.max(1.05, 1.9 + sp * .3 + clamp(-v.y * .025, -.6, 1.2)) * (phoneCam ? 1.15 : 1);
    const wantOff = dir.clone().multiplyScalar(-dist).addScaledVector(camUp, hgt);
    const wantLook = dir.clone().multiplyScalar(3.4 + sp * 2.2).addScaledVector(camUp, .55 + clamp(v.y * .04, -1.2, 2.2));
    if (!camOff) { camOff = wantOff.clone(); lookOff = wantLook.clone(); }
    else { camOff.lerp(wantOff, 1 - Math.exp(-7 * dt)); lookOff.lerp(wantLook, 1 - Math.exp(-8 * dt)); }
    const base = createVector(p.x, camAnchorY, p.z);
    const keepInTunnel = (pt, margin) => {
        if (!(p.z > TUNNEL.z0 && p.z < TUNNEL.z1 && tR < TUNNEL.radius + 1.8)) return;
        const dx = pt.x - TUNNEL.x, dy = pt.y - TUNNEL.y, rd = Math.hypot(dx, dy), lim = TUNNEL.radius - margin;
        if (rd > lim) { pt.x = TUNNEL.x + dx * lim / rd; pt.y = TUNNEL.y + dy * lim / rd; }
    };
    const want = base.clone().add(camOff);
    want.y = Math.max(want.y, getSurfaceHeight(want.x, want.z) + 1, .7);
    keepInTunnel(want, .6);
    const chaseTarget = base.clone().add(lookOff);
    const mouseTarget = p.clone().addScaledVector(camUp, 1);
    if (!mouseLookActive && mouseLookHold) {
        mouseReturnDelay -= dt;
        if (mouseReturnDelay <= 0) { mouseLookHold = false; mouseReturnProgress = 0; }
    }
    else if (!mouseLookActive && !mouseLookHold && mouseReturnProgress < 1) {
        mouseReturnProgress = Math.min(1, mouseReturnProgress + dt / MOUSE_RETURN_DURATION);
    }
    const hasMouseView = mouseLookActive || mouseLookHold || mouseReturnProgress < 1;
    let cameraDestination = want, desiredLookTarget = chaseTarget;
    if (hasMouseView) {
        const baseOffset = want.clone().sub(mouseTarget);
        const baseYaw = Math.atan2(baseOffset.x, baseOffset.z);
        const basePitch = Math.asin(clamp(baseOffset.y / Math.max(baseOffset.length(), 1e-4), -1, 1));
        const orbitDistance = Math.max(baseOffset.length() * 1.5, 9);
        const orbitYaw = baseYaw + mouseLookYaw;
        const orbitPitch = clamp(basePitch + mouseLookPitch, -.35, 1.12);
        const hd = Math.cos(orbitPitch) * orbitDistance;
        const orbitDestination = mouseTarget.clone().add(createVector(Math.sin(orbitYaw) * hd, Math.sin(orbitPitch) * orbitDistance, Math.cos(orbitYaw) * hd));
        orbitDestination.y = Math.max(orbitDestination.y, getSurfaceHeight(orbitDestination.x, orbitDestination.z) + 1.2);
        keepInTunnel(orbitDestination, .8);
        if (mouseLookActive || mouseLookHold) { cameraDestination = orbitDestination; desiredLookTarget = mouseTarget; }
        else {
            const eased = mouseReturnProgress * mouseReturnProgress * (3 - 2 * mouseReturnProgress);
            cameraDestination = orbitDestination.clone().lerp(want, eased);
            desiredLookTarget = mouseTarget.clone().lerp(chaseTarget, eased);
            if (mouseReturnProgress >= 1) { mouseLookYaw = 0; mouseLookPitch = 0; }
        }
    }
    if (!hasMouseView || !cameraLookTarget) cameraLookTarget = desiredLookTarget.clone();
    else cameraLookTarget.lerp(desiredLookTarget, 1 - Math.exp(-12 * dt));
    if (!hasMouseView) camera.position.copy(cameraDestination);
    else camera.position.lerp(cameraDestination, 1 - Math.exp(-10 * dt));
    vehicleState.shake *= Math.exp(-5 * dt);
    shakeT += dt * 24;
    const shk = vehicleState.shake * .35 + sp * .006;
    camera.position.add(createVector(Math.sin(shakeT * 1.7) * shk, Math.sin(shakeT * 2.3 + 1) * shk, Math.sin(shakeT * 1.1 + 2) * shk));
    camera.up.copy(camUp);
    camera.lookAt(cameraLookTarget);
    const lat = v.x * dir.z - v.z * dir.x;
    camRoll += (clamp(lat * .0028, -.05, .05) - camRoll) * (1 - Math.exp(-4 * dt));
    camera.rotateZ(camRoll);
    camFov += (62 + Math.min(spd, 90) * .11 + vehicleState.tl * 5 - camFov) * (1 - Math.exp(-3 * dt));
    camera.fov = camFov + G.boostFx * 9;
    if (window.__cam) window.__cam(camera, p, q);
    }
    camera.updateProjectionMatrix();
    particleScale.value = renderer.domElement.height * .5 / Math.tan(camera.fov * Math.PI / 360);
    skyDome.position.copy(camera.position);
    mtns.forEach(m => m.position.set(camera.position.x, 0, camera.position.z));
    speedFx += (clamp((spd - 15) / 70, 0, 1) - speedFx) * (1 - Math.exp(-3 * dt));
    if (fxPass) fxPass.uniforms.speed.value = speedFx * .55 + G.boostFx * .5;
    getElement('spd').textContent = Math.round(spd * 3.6);
    getElement('fuel').style.width = vehicleState.fuel + '%';
    getElement('fuel').style.background = vehicleState.fuel < 20 ? '#ff3b30' : '#e8f1ff';
    getElement('fuel-percent').textContent = Math.round(vehicleState.fuel) + '%';
    const gm = vehicleState.g.length();
    vehicleState.gp = Math.max(gm, vehicleState.gp * Math.exp(-dt / 2.5));
    const modeLabel = vehicleState.auto ? 'AUTO' : 'MANUAL';
    const detailedModeLabel = vehicleState.auto && vehicleState.air > 0 && vehicleState.lev ? 'AUTO · LANDING ASSIST' : modeLabel;
    getElement('mode-status').textContent = modeLabel;
    getElement('mode-status').className = 'm' + (vehicleState.auto ? '' : ' man');
    const gripButton = getElement('mobile-grip');
    if (gripButton) {
        gripButton.classList.toggle('active', wallGripEnabled);
        gripButton.textContent = wallGripEnabled ? 'GRIP ON' : 'GRIP OFF';
        gripButton.setAttribute('aria-pressed', String(wallGripEnabled));
    }
    const telemetryMarkup = `<div><b>Mode:</b> ${detailedModeLabel}</div><div><b>Wall grip:</b> ${(vehicleState.ad * 100) | 0}% · ${wallGripEnabled ? 'enabled' : 'released'}</div><div><b>Drift:</b> ${vehicleState.drifting ? 'brake + steer' : 'off'}</div><div><b>G-force:</b> <span style="color:${gm > 4 ? '#ff3b30' : 'inherit'}">${gm.toFixed(1)}</span> (up ${vehicleState.g.y.toFixed(1)} · side ${vehicleState.g.x.toFixed(1)}) · peak ${vehicleState.gp.toFixed(1)}</div><div><b>Altitude:</b> ${Math.max(0, p.y - getSurfaceHeight(p.x, p.z) - .5).toFixed(0)} m · <b>Air time:</b> ${vehicleState.air.toFixed(1)} s</div><div><b>Last jump:</b> ${vehicleState.jump | 0} m · <b>Best:</b> ${vehicleState.best | 0} m</div>`;
    getElement('details-stats').innerHTML = telemetryMarkup;
    getElement('desktop-telemetry-content').innerHTML = telemetryMarkup;
}
setThrusterMode();
respawn(0, true);
camera.position.set(-6, 4, -40);
renderer.compileAsync(scene, camera).catch(() => {}).then(() => { loadScreen.compiled = true; loadScreen.check(); });
(function loop(t) {
    requestAnimationFrame(loop);
    if (!loadScreen.done && ++loadScreen.frames >= 3) loadScreen.check();
    const dt = Math.min(.1, (t - previousFrameTime) / 1000);
    previousFrameTime = t;
    if (gameRunning) {
        simulationAccumulator += dt;
        while (simulationAccumulator >= 1 / 120) {
            prevP.copy(vehicleState.p);
            prevQ.copy(vehicleState.q);
            updatePhysics(1 / 120);
            simulationAccumulator -= 1 / 120;
        }
    }
    renderFrame(dt);
    if (composer) {
        fxPass.uniforms.time.value = (t * .001) % 100;
        composer.render();
        perfT = perfT * .96 + dt * .04;
        if (t > 3000 && perfT > .026 && qTier < 1) { qTier = 1; bloomPass.strength.value = .32; renderer.setPixelRatio(1); resizeRenderer(); }
        else if (t > 6000 && perfT > .034 && qTier < 2) { qTier = 2; composer.disableBloom(); key.shadow.mapSize.set(1024, 1024); }
    }
    else renderer.render(scene, camera);
})(previousFrameTime);
