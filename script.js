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
const THREE_NS = THREE, createVector = (x = 0, y = 0, z = 0) => new THREE_NS.Vector3(x, y, z), getElement = id => document.getElementById(id);
const renderer = new THREE_NS.WebGLRenderer({
    antialias: true
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE_NS.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.outputEncoding = THREE_NS.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE_NS.PCFSoftShadowMap;
getElement('c').appendChild(renderer.domElement);
const scene = new THREE_NS.Scene();
scene.background = new THREE_NS.Color(0x080b12);
scene.fog = new THREE_NS.Fog(0x080b12, 90, 520);
const camera = new THREE_NS.PerspectiveCamera(60, 1, .1, 700);
{
    const e = new THREE_NS.Scene();
    e.add(new THREE_NS.Mesh(new THREE_NS.SphereGeometry(30, 16, 16), new THREE_NS.MeshBasicMaterial({
        color: 0x101216,
        side: THREE_NS.BackSide
    })));
    const pn = (w, h, p, r, c, k) => {
        const m = new THREE_NS.Mesh(new THREE_NS.PlaneGeometry(w, h), new THREE_NS.MeshBasicMaterial({
            color: new THREE_NS.Color(c).multiplyScalar(k),
            side: THREE_NS.DoubleSide
        }));
        m.position.set(...p);
        m.rotation.set(...r);
        e.add(m);
    };
    pn(10, 6, [0, 9, 0], [Math.PI / 2, 0, 0], 0xffffff, 5);
    pn(2, 8, [-9, 3, 0], [0, Math.PI / 2, 0], 0xdfe8ff, 4);
    pn(2, 8, [9, 3, 0], [0, Math.PI / 2, 0], 0xffffff, 3);
    pn(14, 2, [0, 2, -10], [0, 0, 0], 0xff2020, 4);
    scene.environment = new THREE_NS.PMREMGenerator(renderer).fromScene(e, .02).texture;
}
const ambient = new THREE_NS.HemisphereLight(0xb9d2ff, 0x171a22, 0.72);
scene.add(ambient);
const fillLight = new THREE_NS.DirectionalLight(0x8baeff, 0.48);
fillLight.position.set(-42, 28, -35);
scene.add(fillLight);
const key = new THREE_NS.DirectionalLight(0xffffff, 1.35);
key.position.set(40, 80, 30);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
const shc = key.shadow.camera;
shc.left = shc.bottom = -16;
shc.right = shc.top = 16;
shc.near = 1;
shc.far = 220;
key.shadow.bias = -.0005;
key.shadow.normalBias = .04;
scene.add(key, key.target);
{
    const n = 500, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const th = Math.random() * 6.28, ph = Math.acos(Math.random() * .9 + .1);
        a[i * 3] = 600 * Math.sin(ph) * Math.cos(th);
        a[i * 3 + 1] = 600 * Math.cos(ph);
        a[i * 3 + 2] = 600 * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE_NS.BufferGeometry();
    g.setAttribute('position', new THREE_NS.BufferAttribute(a, 3));
    scene.add(new THREE_NS.Points(g, new THREE_NS.PointsMaterial({
        size: 1.6,
        sizeAttenuation: false,
        color: 0xaab4c8,
        fog: false
    })));
}
/* ---------- world: analytic height field + visible structures ---------- */
const surfaceRegions = [];
const getSurfaceHeight = (x, z) => {
    let h = 0;
    for (const f of surfaceRegions)
        if (x > f[0] && x < f[1] && z > f[2] && z < f[3])
            h = Math.max(h, f[4] + (f[5] - f[4]) * (z - f[2]) / (f[3] - f[2]));
    return h;
};
function createStructure(x0, x1, z0, z1, h0, h1, col = 0x16181d) {
    surfaceRegions.push([x0, x1, z0, z1, h0, h1]);
    const s = new THREE_NS.Shape();
    s.moveTo(0, 0);
    s.lineTo(z1 - z0, 0);
    s.lineTo(z1 - z0, h1);
    s.lineTo(0, h0);
    s.closePath();
    const g = new THREE_NS.ExtrudeGeometry(s, {
        depth: x1 - x0,
        bevelEnabled: false
    });
    g.rotateY(-Math.PI / 2);
    const m = new THREE_NS.Mesh(g, new THREE_NS.MeshStandardMaterial({
        color: col,
        roughness: .6,
        metalness: .4,
        flatShading: true
    }));
    m.position.set(x1, 0, z0);
    m.receiveShadow = m.castShadow = true;
    scene.add(m);
    m.add(new THREE_NS.LineSegments(new THREE_NS.EdgesGeometry(g, 20), new THREE_NS.LineBasicMaterial({
        color: 0x70313d,
        transparent: true,
        opacity: 0.78
    })));
}
{
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#090c11';
    x.fillRect(0, 0, 128, 128);
    x.strokeStyle = '#171d27';
    x.lineWidth = 1;
    x.strokeRect(0, 0, 128, 128);
    const tx = new THREE_NS.CanvasTexture(c);
    tx.wrapS = tx.wrapT = THREE_NS.RepeatWrapping;
    tx.repeat.set(100, 100);
    tx.anisotropy = 8;
    const fl = new THREE_NS.Mesh(new THREE_NS.PlaneGeometry(1600, 1600), new THREE_NS.MeshStandardMaterial({
        map: tx,
        roughness: .62,
        metalness: .28
    }));
    fl.rotation.x = -Math.PI / 2;
    fl.receiveShadow = true;
    scene.add(fl);
}
const neon = new THREE_NS.MeshBasicMaterial({
    color: new THREE_NS.Color(0xff3548).multiplyScalar(1.05)
});
[-8, 8].forEach(x => {
    const m = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(.2, .03, 300), neon);
    m.position.set(x, .02, 100);
    scene.add(m);
});
for (let z = -20; z <= 140; z += 20)
    [-12, 12].forEach(x => {
        const m = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(.3, 9, .3), neon);
        m.position.set(x, 4.5, z);
        scene.add(m);
    });
/* Subtle runway centreline markings for a more finished test facility. */
const lanePaint = new THREE_NS.MeshBasicMaterial({ color: 0x77869d, transparent: true, opacity: 0.42 });
for (let z = -26; z < 145; z += 12) {
    const mark = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(.12, .012, 3.2), lanePaint);
    mark.position.set(0, .025, z);
    scene.add(mark);
}
const shoulderPaint = new THREE_NS.MeshBasicMaterial({ color: 0x293342, transparent: true, opacity: 0.8 });
[-5.8, 5.8].forEach(x => {
    const line = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(.045, .014, 260), shoulderPaint);
    line.position.set(x, .024, 105);
    scene.add(line);
});
createStructure(-6, 6, 120, 135, 0, 4, 0x24272d);
/* ramp to car row */
for (let i = 0; i < 6; i++)
    createStructure(-1.1, 1.1, 148 + i * 5.4, 152.6 + i * 5.4, 1.3, 1.3, [0x2b2e34, 0x3a2020, 0x20262e][i % 3]);
/* parked cars */
createStructure(50, 70, -40, 0, 0, 14, 0x24272d);
createStructure(50, 70, 0, 100, 14, 14);
/* ---------- wall ride: steep climb with a backward-throwing crest ---------- */
const wallRideConfig = {
    x0: -70,
    x1: -50,
    z0: 0,
    R: 24,
    Y: 51,
    topRadius: 12,
    throwAngle: 1.88 // Softer backward throw while still returning toward the approach
};
/* Shared profile for rendering and collision. The upper curve passes its highest
   point and turns backward/downward, so the car exits travelling back toward -Z. */
const wallRideProfile = [];
const wallSamples = 40;
for (let i = 0; i <= wallSamples; i++) {
    const a = -Math.PI / 2 + (i / wallSamples) * Math.PI / 2;
    wallRideProfile.push([
        wallRideConfig.z0 + wallRideConfig.R * Math.cos(a),
        wallRideConfig.R + wallRideConfig.R * Math.sin(a)
    ]);
}
const crestStartY = wallRideConfig.Y - wallRideConfig.topRadius;
const wallTopZ = wallRideConfig.z0 + wallRideConfig.R;
wallRideProfile.push([wallTopZ, crestStartY]);
const crestSamples = 36;
const crestCenterZ = wallTopZ - wallRideConfig.topRadius;
const crestCenterY = crestStartY;
for (let i = 1; i <= crestSamples; i++) {
    const a = (i / crestSamples) * wallRideConfig.throwAngle;
    wallRideProfile.push([
        crestCenterZ + wallRideConfig.topRadius * Math.cos(a),
        crestCenterY + wallRideConfig.topRadius * Math.sin(a)
    ]);
}
{
    /* Build an open driving surface across the wall width. Unlike the old
       extruded shape, this has no giant vertical end caps or filled side faces. */
    const positions = [];
    const indices = [];
    const width = wallRideConfig.x1 - wallRideConfig.x0;
    wallRideProfile.forEach(([z, y]) => {
        positions.push(wallRideConfig.x0, y, z, wallRideConfig.x1, y, z);
    });
    for (let i = 0; i < wallRideProfile.length - 1; i++) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE_NS.BufferGeometry();
    geometry.setAttribute('position', new THREE_NS.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const wall = new THREE_NS.Mesh(geometry, new THREE_NS.MeshStandardMaterial({
        color: 0x20252d,
        roughness: 0.4,
        metalness: 0.48,
        side: THREE_NS.DoubleSide
    }));
    wall.receiveShadow = true;
    wall.castShadow = true;
    scene.add(wall);
    /* Fine edge rails follow the climb and the backward-throwing crest. */
    const railMaterial = new THREE_NS.LineBasicMaterial({
        color: 0x9b3442,
        transparent: true,
        opacity: 0.9
    });
    [wallRideConfig.x0 + 0.35, wallRideConfig.x1 - 0.35].forEach(x => {
        const railPoints = wallRideProfile.map(([z, y]) => createVector(x, y + 0.035, z));
        scene.add(new THREE_NS.Line(new THREE_NS.BufferGeometry().setFromPoints(railPoints), railMaterial));
    });
}
/* ---------- wall-grip tunnel: a full circular inner surface ---------- */
const TUNNEL = {
    x: 30,
    y: 12.5, // center the tunnel so its bottom is almost level with the ground
    radius: 12.8, // medium-sized tunnel: large enough for wall riding, without overlapping courses
    outerRadius: 13.45, // visible tunnel shell
    z0: -46, // keep the tunnel clear of the launch ramp and cliff structures
    z1: 78
};
{
    const tunnelLength = TUNNEL.z1 - TUNNEL.z0;
    const tunnelCenterZ = (TUNNEL.z0 + TUNNEL.z1) * 0.5;
    const shellGeometry = new THREE_NS.CylinderGeometry(TUNNEL.outerRadius, TUNNEL.outerRadius, tunnelLength, 64, 1, true);
    shellGeometry.rotateX(Math.PI / 2);
    const shell = new THREE_NS.Mesh(shellGeometry, new THREE_NS.MeshStandardMaterial({
        color: 0x151c27,
        roughness: 0.38,
        metalness: 0.68,
        side: THREE_NS.DoubleSide
    }));
    shell.position.set(TUNNEL.x, TUNNEL.y, tunnelCenterZ);
    shell.castShadow = true;
    shell.receiveShadow = true;
    scene.add(shell);
    const ribMaterial = new THREE_NS.MeshStandardMaterial({
        color: 0x354252,
        roughness: 0.34,
        metalness: 0.78,
        emissive: 0x080d16
    });
    for (let z = TUNNEL.z0 + 2; z < TUNNEL.z1; z += 11) {
        const rib = new THREE_NS.Mesh(new THREE_NS.TorusGeometry(TUNNEL.outerRadius - 0.12, 0.095, 8, 56), ribMaterial);
        rib.position.set(TUNNEL.x, TUNNEL.y, z);
        scene.add(rib);
    }
    const portalMaterial = new THREE_NS.MeshStandardMaterial({
        color: 0x7f3444,
        roughness: 0.3,
        metalness: 0.72,
        emissive: 0x26060c
    });
    [TUNNEL.z0, TUNNEL.z1].forEach(z => {
        const portal = new THREE_NS.Mesh(new THREE_NS.TorusGeometry(TUNNEL.outerRadius - 0.02, 0.22, 10, 64), portalMaterial);
        portal.position.set(TUNNEL.x, TUNNEL.y, z);
        scene.add(portal);
    });
    const guideLight = new THREE_NS.MeshBasicMaterial({ color: 0x90cfff });
    for (let z = TUNNEL.z0 + 5; z < TUNNEL.z1 - 3; z += 18) {
        const light = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(1.1, 0.12, 1.8), guideLight);
        light.position.set(TUNNEL.x, TUNNEL.y + TUNNEL.radius - 1.0, z);
        scene.add(light);
    }
    const laneLight = new THREE_NS.MeshBasicMaterial({
        color: 0x6c9bb6,
        transparent: true,
        opacity: 0.8
    });
    [-0.85, 0.85].forEach(offsetX => {
        const stripe = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(0.055, 0.025, tunnelLength), laneLight);
        stripe.position.set(TUNNEL.x + offsetX, 0.025, tunnelCenterZ);
        scene.add(stripe);
    });
}
/* cliff approach + plateau */
const TG = [[160, 28, 'WIDE'], [205, 14, 'MEDIUM'], [250, 7, 'NARROW']];
TG.forEach(t => {
    const m = new THREE_NS.Mesh(new THREE_NS.PlaneGeometry(t[1], 20), new THREE_NS.MeshBasicMaterial({
        color: 0x0e3a22,
        transparent: true,
        opacity: .7
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(60, .03, t[0]);
    scene.add(m);
    const l = new THREE_NS.LineSegments(new THREE_NS.EdgesGeometry(m.geometry), new THREE_NS.LineBasicMaterial({
        color: 0x3dff8a
    }));
    l.rotation.x = -Math.PI / 2;
    l.position.copy(m.position);
    scene.add(l);
});
/* ---------- the Roadster ---------- */
const paint = new THREE_NS.MeshPhysicalMaterial({
    color: 0xe7ebf2,
    vertexColors: true,
    roughness: .27,
    metalness: .58,
    clearcoat: 0.92,
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
function buildLoftedGeometry(st) {
    const originalRings = st.map(section => section.pts.map(point => [point[0], point[1], section.z]).concat(section.pts.slice(1, -1).reverse().map(point => [-point[0], point[1], section.z])));
    const ringSize = originalRings[0].length;
    const rowCount = Math.max(st.length, (st.length - 1) * 5 + 1);
    const curves = Array.from({ length: ringSize }, (_, pointIndex) => new THREE_NS.CatmullRomCurve3(originalRings.map(ring => new THREE_NS.Vector3(...ring[pointIndex])), false, 'catmullrom', 0.5));
    const rings = [];
    const levels = [];
    for (let row = 0; row < rowCount; row++) {
        const t = row / (rowCount - 1);
        const sectionPosition = t * (st.length - 1);
        const sectionIndex = Math.min(st.length - 2, Math.floor(sectionPosition));
        const localT = sectionPosition - sectionIndex;
        levels.push(st[sectionIndex].yl + (st[sectionIndex + 1].yl - st[sectionIndex].yl) * localT);
        rings.push(curves.map(curve => curve.getPoint(t).toArray()));
    }
    const positions = [];
    const colors = [];
    const addTriangle = (a, b, c, shade) => {
        [a, b, c].forEach(vertex => positions.push(...vertex));
        for (let i = 0; i < 3; i++)
            colors.push(shade, shade, shade);
    };
    const shadeForEdge = (a, b, level) => Math.max(a[1], b[1]) <= level + 1e-3 ? 0.075 : 1;
    for (let row = 0; row < rings.length - 1; row++) {
        for (let column = 0; column < ringSize; column++) {
            const a = rings[row][column];
            const b = rings[row][(column + 1) % ringSize];
            const c = rings[row + 1][(column + 1) % ringSize];
            const d = rings[row + 1][column];
            const shade = shadeForEdge(a, b, levels[row]);
            addTriangle(a, b, c, shade);
            addTriangle(a, c, d, shade);
        }
    }
    [0, rings.length - 1].forEach(rowIndex => {
        const ring = rings[rowIndex];
        const center = ring.reduce((sum, point) => [
            sum[0] + point[0] / ringSize,
            sum[1] + point[1] / ringSize,
            sum[2] + point[2] / ringSize
        ], [0, 0, 0]);
        for (let column = 0; column < ringSize; column++) {
            const a = ring[column];
            const b = ring[(column + 1) % ringSize];
            addTriangle(center, a, b, shadeForEdge(a, b, levels[rowIndex]));
        }
    });
    const geometry = new THREE_NS.BufferGeometry();
    geometry.setAttribute('position', new THREE_NS.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE_NS.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    /* The faces are intentionally non-indexed; average matching-position normals to smooth their joins. */
    const positionAttribute = geometry.getAttribute('position');
    const normalAttribute = geometry.getAttribute('normal');
    const normalSums = new Map();
    const keys = [];
    for (let i = 0; i < positionAttribute.count; i++) {
        const key = [
            positionAttribute.getX(i).toFixed(4),
            positionAttribute.getY(i).toFixed(4),
            positionAttribute.getZ(i).toFixed(4)
        ].join(',');
        keys.push(key);
        const sum = normalSums.get(key) || new THREE_NS.Vector3();
        sum.x += normalAttribute.getX(i);
        sum.y += normalAttribute.getY(i);
        sum.z += normalAttribute.getZ(i);
        normalSums.set(key, sum);
    }
    for (let i = 0; i < normalAttribute.count; i++) {
        const normal = normalSums.get(keys[i]).normalize();
        normalAttribute.setXYZ(i, normal.x, normal.y, normal.z);
    }
    normalAttribute.needsUpdate = true;
    return geometry;
}
const createBodySection = (z, w, hb, hs, f = .38) => {
    const d = hs - hb;
    return {
        z,
        yl: hb + d * f,
        pts: [[0, hb], [.8 * w, hb], [w, hb + d * .1], [w, hb + d * f], [w, hs - d * .12], [.82 * w, hs], [.35 * w, hs + .02], [0, hs + .03]]
    };
}, createCabinSection = (z, b, r, bw, rw) => ({
    z,
    yl: -1,
    pts: [[0, b], [bw, b], [rw, r], [0, r + .01]]
});
const rig = new THREE_NS.Group(), car = new THREE_NS.Group();
car.position.y = -.5;
rig.add(car);
scene.add(rig);
const addBoxMesh = (w, h, d, m, x, y, z, p = car) => {
    const o = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    p.add(o);
    return o;
};
car.add(new THREE_NS.Mesh(buildLoftedGeometry([createBodySection(2.3, .85, .18, .38, .7), createBodySection(2, .95, .14, .45, .5), createBodySection(1.2, 1, .14, .62), createBodySection(.7, 1.02, .16, .78), createBodySection(-.4, 1.05, .16, .86), createBodySection(-1.4, 1.06, .18, .92), createBodySection(-2.1, 1, .25, .88), createBodySection(-2.3, .95, .3, .84)]), paint));
car.add(new THREE_NS.Mesh(buildLoftedGeometry([createCabinSection(.9, .66, .84, .84, .68), createCabinSection(.1, .78, 1.12, .86, .55), createCabinSection(-.9, .85, 1.1, .86, .5), createCabinSection(-1.6, .88, .94, .8, .7)]), glass));
addBoxMesh(1.55, .022, .02, whiteLed, 0, .325, 2.305);
addBoxMesh(1.7, .03, .3, carbon, 0, .14, 2.2);
[-1, 1].forEach(s => {
    const sh = new THREE_NS.Shape();
    sh.moveTo(0, 0);
    sh.lineTo(s * .2, 0);
    sh.lineTo(s * .04, .12);
    sh.closePath();
    const h = new THREE_NS.Mesh(new THREE_NS.ShapeGeometry(sh), whiteLed);
    h.position.set(s * .46, .425, 2.04);
    h.rotation.x = -Math.PI / 2 + .23;
    car.add(h);
});
addBoxMesh(1.9, .035, .03, redLed, 0, .8, -2.31);
addBoxMesh(2, .035, .22, plain, 0, .845, -2.3);
addBoxMesh(1.55, .2, .32, carbon, 0, .2, -2.18);
addBoxMesh(.46, .2, .02, plain, 0, .56, -2.31);
[-.45, -.15, .15, .45].forEach(x => {
    const t = new THREE_NS.Mesh(new THREE_NS.CylinderGeometry(.05, .05, .07, 20), bronze);
    t.rotation.x = Math.PI / 2;
    t.position.set(x, .36, -2.32);
    car.add(t);
});
/* Aero trim: carbon splitter, side skirts, sculpted intakes and fine hood accents. */
const aeroBlack = new THREE_NS.MeshStandardMaterial({ color: 0x090c12, roughness: .3, metalness: .58 });
const trimSilver = new THREE_NS.MeshStandardMaterial({ color: 0x76869d, roughness: .28, metalness: .78 });
const intakeMat = new THREE_NS.MeshStandardMaterial({ color: 0x020305, roughness: .36, metalness: .35 });
addBoxMesh(1.8, .055, .24, aeroBlack, 0, .07, 2.18);
addBoxMesh(.13, .14, 1.52, aeroBlack, -.94, .015, .02);
addBoxMesh(.13, .14, 1.52, aeroBlack, .94, .015, .02);
[-1, 1].forEach(side => {
    addBoxMesh(.025, .19, .58, intakeMat, side * 1.015, .27, -.47);
    addBoxMesh(.027, .035, .42, trimSilver, side * 1.03, .39, -.47);
    addBoxMesh(.018, .012, 1.18, trimSilver, side * .73, .374, .2);
    addBoxMesh(.018, .012, .68, trimSilver, side * .39, .405, 1.32);
});
/* A restrained rear diffuser makes the exhaust end read as a finished performance car. */
for (let x = -.62; x <= .63; x += .31) {
    const fin = addBoxMesh(.045, .12, .42, aeroBlack, x, .115, -2.08);
    fin.rotation.x = -.12;
}
const headlightGlow = new THREE_NS.PointLight(0xd7e7ff, .7, 8);
headlightGlow.position.set(0, .24, 2.3);
car.add(headlightGlow);
const rimM = new THREE_NS.MeshStandardMaterial({
    color: 0xaeb9ca,
    roughness: .26,
    metalness: .82
}), dk2 = new THREE_NS.MeshStandardMaterial({
    color: 0x171c25,
    roughness: .32,
    metalness: .78
}), rotorM = new THREE_NS.MeshStandardMaterial({ color: 0x59616d, roughness: .48, metalness: .78 }), caliperM = new THREE_NS.MeshStandardMaterial({ color: 0xc72c3b, roughness: .3, metalness: .52 }), WV = [];
function wheel(x, z, s, fr) {
    const g = new THREE_NS.Group();
    g.rotation.order = 'YXZ';
    g.position.set(x, .36, z);
    const t = new THREE_NS.Mesh(new THREE_NS.CylinderGeometry(.36, .36, .3, 32), new THREE_NS.MeshStandardMaterial({
        color: 0x08080a,
        roughness: .85
    }));
    t.rotation.z = Math.PI / 2;
    g.add(t);
    const f = new THREE_NS.Mesh(new THREE_NS.CylinderGeometry(.27, .27, .02, 32), rimM);
    f.rotation.z = Math.PI / 2;
    f.position.x = s * .155;
    g.add(f);
    for (let i = 0; i < 10; i++) {
        const spokeGroup = new THREE_NS.Group();
        spokeGroup.rotation.x = i * 2 * Math.PI / 10;
        g.add(spokeGroup);
        const spoke = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(.025, .27, .055), dk2);
        spoke.position.set(s * .168, .135, 0);
        spokeGroup.add(spoke);
    }
    const rotor = new THREE_NS.Mesh(new THREE_NS.CylinderGeometry(.225, .225, .025, 40), rotorM);
    rotor.rotation.z = Math.PI / 2;
    rotor.position.x = s * .145;
    g.add(rotor);
    const rimRing = new THREE_NS.Mesh(new THREE_NS.TorusGeometry(.235, .014, 8, 40), rimM);
    rimRing.rotation.y = Math.PI / 2;
    rimRing.position.x = s * .174;
    g.add(rimRing);
    const hub = new THREE_NS.Mesh(new THREE_NS.CylinderGeometry(.062, .062, .035, 24), rimM);
    hub.rotation.z = Math.PI / 2;
    hub.position.x = s * .182;
    g.add(hub);
    const caliper = new THREE_NS.Mesh(new THREE_NS.BoxGeometry(.055, .13, .09), caliperM);
    caliper.position.set(s * .151, -.12, .17);
    g.add(caliper);
    car.add(g);
    WV.push([g, fr]);
    // Removed the oversized dark wheel-face disc; tire sidewalls and detailed rims remain.
}
[-1, 1].forEach(s => {
    wheel(s * .9, 1.45, s, 1);
    wheel(s * .98, -1.35, s, 0);
});
const wing = new THREE_NS.Group();
wing.position.set(0, .62, -2.2);
car.add(wing);
addBoxMesh(2.05, .045, .58, aeroBlack, 0, .25, -.12, wing).rotation.x = .14;
[-1, 1].forEach(s => {
    addBoxMesh(.04, .34, .64, trimSilver, s, .14, -.1, wing);
    addBoxMesh(.04, .3, .05, aeroBlack, s * .5, .1, 0, wing);
});
const glow = new THREE_NS.PointLight(0xc7dcff, 0, 16);
glow.position.set(0, .2, -3);
const underGlow = new THREE_NS.PointLight(0x426dff, 1.1, 8);
underGlow.position.set(0, -.28, 0);
const rearRim = new THREE_NS.PointLight(0xff2539, .55, 9);
rearRim.position.set(0, .25, -2.2);
rig.add(glow, underGlow, rearRim);
car.traverse(o => {
    if (o.isMesh)
        o.castShadow = true;
});
const hl = new THREE_NS.SpotLight(0xdfeaff, 2.4, 80, .5, .7, 1);
hl.position.set(0, .2, 2.2);
hl.target.position.set(0, -.5, 16);
rig.add(hl, hl.target);
/* ---------- particles: thruster plume + landing dust ---------- */
const PARTICLE_COUNT = 1800, particlePositions = new Float32Array(PARTICLE_COUNT * 3), particleColors = new Float32Array(PARTICLE_COUNT * 3), particleVelocities = new Float32Array(PARTICLE_COUNT * 3), particleLifetimes = new Float32Array(PARTICLE_COUNT).fill(1), particleAges = new Float32Array(PARTICLE_COUNT).fill(1), particleKinds = new Uint8Array(PARTICLE_COUNT);
let nextParticleIndex = 0;
{
    const g = new THREE_NS.BufferGeometry();
    g.setAttribute('position', new THREE_NS.BufferAttribute(particlePositions, 3));
    g.setAttribute('color', new THREE_NS.BufferAttribute(particleColors, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d'), r = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, '#fff');
    r.addColorStop(1, '#0000');
    x.fillStyle = r;
    x.fillRect(0, 0, 64, 64);
    const p = new THREE_NS.Points(g, new THREE_NS.PointsMaterial({
        size: 1.65,
        map: new THREE_NS.CanvasTexture(c),
        vertexColors: true,
        transparent: true,
        blending: THREE_NS.AdditiveBlending,
        depthWrite: false
    }));
    p.frustumCulled = false;
    scene.add(p);
    window.pg = g;
}
const emitParticle = (p, v, l, k) => {
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
    drifting: false
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
function getTerrainNormal(x, z) {
    const e = .6, n = createVector(getSurfaceHeight(x - e, z) - getSurfaceHeight(x + e, z), 2 * e, getSurfaceHeight(x, z - e) - getSurfaceHeight(x, z + e)).normalize();
    return n.y < .6 ? createVector(0, 1, 0) : n;
}
function getWallRideContact(P) {
    if (P.x < wallRideConfig.x0 || P.x > wallRideConfig.x1 || P.y > wallRideConfig.Y + 4)
        return null;
    let bestDistanceSq = Infinity;
    let bestSignedDistance = 0;
    let bestNormal = createVector(0, 1, 0);
    /* Treat each profile segment as a short line with its own outward surface normal. */
    for (let i = 0; i < wallRideProfile.length - 1; i++) {
        const a = wallRideProfile[i];
        const b = wallRideProfile[i + 1];
        const dz = b[0] - a[0];
        const dy = b[1] - a[1];
        const lengthSq = dz * dz + dy * dy;
        if (lengthSq < 1e-8)
            continue;
        const t = clamp(((P.z - a[0]) * dz + (P.y - a[1]) * dy) / lengthSq, 0, 1);
        const closestZ = a[0] + dz * t;
        const closestY = a[1] + dy * t;
        const offsetZ = P.z - closestZ;
        const offsetY = P.y - closestY;
        const distanceSq = offsetZ * offsetZ + offsetY * offsetY;
        if (distanceSq >= bestDistanceSq)
            continue;
        const length = Math.sqrt(lengthSq);
        const normalY = dz / length;
        const normalZ = -dy / length;
        bestDistanceSq = distanceSq;
        bestSignedDistance = offsetY * normalY + offsetZ * normalZ;
        bestNormal = createVector(0, normalY, normalZ);
    }
    /* Avoid treating the wall ride as an invisible giant surface after the ramp ends. */
    if (bestDistanceSq > 2.8 * 2.8)
        return null;
    return [bestSignedDistance, bestNormal];
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
    const wallContact = getWallRideContact(P);
    if (wallContact && wallContact[0] < contact[0])
        contact = wallContact;
    const tunnel = tunnelContact(P);
    if (tunnel && tunnel[0] < contact[0])
        contact = tunnel;
    return contact;
}
const clamp = (x, a = -1, b = 1) => Math.max(a, Math.min(b, x));
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
        if (depth > correctionDepth) {
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
    const pq = getWallRideContact(p);
    if (pq && pq[0] < .2) {
        p.addScaledVector(pq[1], .2 - pq[0]);
        const vn = v.dot(pq[1]);
        if (vn < 0)
            v.addScaledVector(pq[1], -vn);
    }
    const hz = createVector(fw.x, 0, fw.z).normalize().multiplyScalar(2.2), hc = getSurfaceHeight(p.x, p.z);
    if (!(pq && pq[0] < 4))
        for (const o of [hz, hz.clone().negate()]) {
            const ho = getSurfaceHeight(p.x + o.x, p.z + o.z);
            if (ho > p.y + .2 && ho - hc > 1) {
                p.x = pv0.x;
                p.z = pv0.z;
                v.x *= -.25;
                v.z *= -.25;
                vehicleState.shake = .4;
                break;
            }
        }
    if (p.y < -30 || Math.abs(p.x) > 700 || Math.abs(p.z) > 700)
        selectScenario(activeScenarioIndex);
    if (nc === 0) {
        if (vehicleState.air === 0) {
            vehicleState.t0.copy(p);
            vehicleState.maxH = 0;
        }
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
}
function handleLanding() {
    const d = Math.hypot(vehicleState.p.x - vehicleState.t0.x, vehicleState.p.z - vehicleState.t0.z), imp = -vehicleState.lastVy;
    vehicleState.jump = d;
    vehicleState.best = Math.max(vehicleState.best, d);
    vehicleState.shake = Math.min(1, imp / 18);
    playLandingImpact(imp);
    let m = `${d | 0} m · ${vehicleState.air.toFixed(1)} s air`;
    for (const t of TG)
        if (Math.abs(vehicleState.p.x - 60) < t[1] / 2 && Math.abs(vehicleState.p.z - t[0]) < 10)
            m = `LANDED IN ${t[2]} TARGET<br>` + m;
    showToast(imp > 14 ? 'HARD LANDING<br>' + m : m);
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
/* ---------- scenarios ---------- */
const SCENARIOS = [
    ['Launch Pad', [0, 0.5, -30], [0, 0, 0]],
    ['Cliff Jump', [60, 0.5, -85], [0, 0, 0]],
    ['Flight Lab', [60, 45, -20], [0, 2, 28]],
    ['Wall Ride', [-60, 0.5, -90], [0, 0, 0]],
    // Start outside the entrance and roll into the tunnel under wheel power.
    ['Wall-Grip Tunnel', [30, 0.5, TUNNEL.z0 - 15], [0, 0, 12]]
];
let activeScenarioIndex = 0, gameRunning = false;
const mobileScenarioSelect = getElement('mobile-scenario-select');
SCENARIOS.forEach((s, i) => {
    const b = document.createElement('button');
    b.textContent = (i + 1) + ' ' + s[0];
    b.onclick = () => {
        selectScenario(i);
        b.blur();
    };
    getElement('sc').appendChild(b);
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = (i + 1) + ' · ' + s[0];
    mobileScenarioSelect.appendChild(option);
});
mobileScenarioSelect.addEventListener('change', () => selectScenario(Number(mobileScenarioSelect.value)));
const mb = document.createElement('button');
getElement('sc').appendChild(mb);
function setThrusterMode(t) {
    if (t)
        vehicleState.auto = !vehicleState.auto;
    mb.textContent = 'Thrusters: ' + (vehicleState.auto ? 'AUTO' : 'MANUAL');
    mb.classList.toggle('on', !vehicleState.auto);
    const mobileModeButton = getElement('mobile-mode');
    if (mobileModeButton) {
        mobileModeButton.textContent = vehicleState.auto ? 'AUTO' : 'MANUAL';
        mobileModeButton.classList.toggle('active', vehicleState.auto);
        mobileModeButton.setAttribute('aria-pressed', String(vehicleState.auto));
    }
    if (t)
        showToast(vehicleState.auto ? 'AUTO · landing assist' : 'MANUAL · direct thruster control');
}
mb.onclick = () => {
    setThrusterMode(1);
    mb.blur();
};
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
function selectScenario(i) {
    activeScenarioIndex = i;
    const s = SCENARIOS[i];
    vehicleState.p.set(...s[1]);
    vehicleState.v.set(...s[2]);
    vehicleState.w.set(0, 0, 0);
    vehicleState.q.set(0, 0, 0, 1);
    vehicleState.fuel = 100;
    vehicleState.air = 0;
    vehicleState.tl = 0;
    thrusters.forEach(t => t.l = t.c = 0);
    vehicleState.ad = 0;
    vehicleState.g.set(0, 1, 0);
    vehicleState.steep = 1;
    vehicleState.steer = 0;
    vehicleState.jump = 0;
    cameraHeading = 0;
    [...getElement('sc').children].forEach((b, j) => b.classList.toggle('on', j === i));
    if (mobileScenarioSelect)
        mobileScenarioSelect.value = String(i);
    showToast(s[0]);
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
        selectScenario(activeScenarioIndex);
    if (e.code === 'KeyM')
        setThrusterMode(1);
    if (e.code === 'KeyG' && !e.repeat)
        toggleWallGrip();
    if (e.code === 'KeyH')
        setDetailsOpen(detailsPanel.hidden);
    const d = +e.key;
    if (d >= 1 && d <= 5)
        selectScenario(d - 1);
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
    const low = ctx.createOscillator();
    const lowGain = ctx.createGain();
    low.type = 'sine';
    low.frequency.setValueAtTime(76 + intensity * 24, now);
    low.frequency.exponentialRampToValueAtTime(31, now + 0.22);
    lowGain.gain.setValueAtTime(0.16 + intensity * 0.32, now);
    lowGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    low.connect(lowGain);
    lowGain.connect(soundState.master);
    low.start(now);
    low.stop(now + 0.25);
    const clunk = ctx.createOscillator();
    const clunkGain = ctx.createGain();
    const clunkFilter = ctx.createBiquadFilter();
    clunk.type = 'triangle';
    clunk.frequency.setValueAtTime(190 + intensity * 85, now);
    clunk.frequency.exponentialRampToValueAtTime(78, now + 0.075);
    clunkFilter.type = 'lowpass';
    clunkFilter.frequency.setValueAtTime(900, now);
    clunkFilter.frequency.exponentialRampToValueAtTime(240, now + 0.12);
    clunkGain.gain.setValueAtTime(0.08 + intensity * 0.22, now);
    clunkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    clunk.connect(clunkFilter);
    clunkFilter.connect(clunkGain);
    clunkGain.connect(soundState.master);
    clunk.start(now);
    clunk.stop(now + 0.15);
    // A very brief filtered road/tire noise makes the landing feel physical, not explosive.
    if (soundState.noiseBuffer) {
        const noise = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const noiseGain = ctx.createGain();
        noise.buffer = soundState.noiseBuffer;
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(420 + intensity * 330, now);
        filter.Q.value = 0.85;
        noiseGain.gain.setValueAtTime(0.045 + intensity * 0.11, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(soundState.master);
        noise.start(now);
        noise.stop(now + 0.09);
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
addEventListener('blur', () => {
    resetJoystick();
    document.querySelectorAll('[data-hold-key]').forEach(button => {
        inputKeys[button.dataset.holdKey] = false;
        button.classList.remove('pressed');
    });
});
/* ---------- render loop ---------- */
let cameraHeading = 0, previousFrameTime = performance.now(), simulationAccumulator = 0;
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
function resizeRenderer() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
addEventListener('resize', resizeRenderer);
resizeRenderer();
function renderFrame(dt) {
    const { p, q, v } = vehicleState, spd = v.length(), fw = createVector(0, 0, 1).applyQuaternion(q);
    updateSound(spd);
    rig.position.copy(p);
    rig.quaternion.copy(q);
    vehicleState.sp += v.dot(fw) * dt / .36;
    WV.forEach(([g, f]) => {
        g.rotation.x = vehicleState.sp;
        g.rotation.y = f ? vehicleState.steer : 0;
    });
    vehicleState.wo += ((spd > 30 || vehicleState.tl > .1 ? 1 : 0) - vehicleState.wo) * Math.min(1, dt * 3);
    wing.position.y = .62 + vehicleState.wo * .38;
    wing.rotation.x = -vehicleState.wo * .08;
    glow.intensity = 2.6 * vehicleState.tl;
    key.position.set(p.x + 30, p.y + 60, p.z + 20);
    key.target.position.copy(p);
    key.target.updateMatrixWorld();
    thrusters.forEach(t => {
        if (t.l > .08) {
            const big = t.m > 10000;
            for (let i = 0; i < (big ? 2 : 1); i++)
                emitParticle(p.clone().add(t.r.clone().add(big ? createVector(randomOffset(.45), 0, 0) : createVector()).applyQuaternion(q)), t.d.clone().applyQuaternion(q)
                    .multiplyScalar(-(big ? 15 : 9) * (.85 + Math.random() * .25))
                    .addScaledVector(v, .32)
                    .add(createVector(randomOffset(.8), randomOffset(.8), randomOffset(.8))), .32 + Math.random() * .3, 0);
        }
    });
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const o = i * 3;
        if (particleAges[i] >= particleLifetimes[i]) {
            particleColors[o] = particleColors[o + 1] = particleColors[o + 2] = 0;
            continue;
        }
        particleAges[i] += dt;
        const t = particleAges[i] / particleLifetimes[i], f = 1 - t, dr = 1 - 2.1 * dt;
        particleVelocities[o] *= dr;
        particleVelocities[o + 1] *= dr;
        particleVelocities[o + 2] *= dr;
        particlePositions[o] += particleVelocities[o] * dt;
        particlePositions[o + 1] += particleVelocities[o + 1] * dt;
        particlePositions[o + 2] += particleVelocities[o + 2] * dt;
        if (particleKinds[i] === 0) {
            const m = Math.min(1, t * 3);
            particleColors[o] = (.6 - .15 * m) * f;
            particleColors[o + 1] = (.64 - .15 * m) * f;
            particleColors[o + 2] = (.7 - .08 * m) * f;
        }
        else {
            particleColors[o] = .4 * f;
            particleColors[o + 1] = .37 * f;
            particleColors[o + 2] = .34 * f;
        }
    }
    pg.attributes.position.needsUpdate = pg.attributes.color.needsUpdate = true;
    /* Chase camera: keep the normal follow responsive; only mouse-look return is delayed. */
    const th = spd > 8 ? Math.atan2(v.x, v.z) : Math.atan2(fw.x, fw.z);
    let df = th - cameraHeading;
    df = Math.atan2(Math.sin(df), Math.cos(df));
    cameraHeading += df * (1 - Math.exp(-3 * dt));
    const dir = createVector(Math.sin(cameraHeading), 0, Math.cos(cameraHeading));
    const want = p.clone().addScaledVector(dir, -(7.8 + Math.min(spd * .006, 0.85)));
    want.y = p.y + 3.4;
    want.y = Math.max(want.y, getSurfaceHeight(want.x, want.z) + 1.5);
    const chaseTarget = p.clone().addScaledVector(dir, 6).add(createVector(0, 1, 0));
    const mouseTarget = p.clone().add(createVector(0, 1, 0));
    if (!mouseLookActive && mouseLookHold) {
        mouseReturnDelay -= dt;
        if (mouseReturnDelay <= 0) {
            mouseLookHold = false;
            mouseReturnProgress = 0;
        }
    }
    else if (!mouseLookActive && !mouseLookHold && mouseReturnProgress < 1) {
        mouseReturnProgress = Math.min(1, mouseReturnProgress + dt / MOUSE_RETURN_DURATION);
    }
    const hasMouseView = mouseLookActive || mouseLookHold || mouseReturnProgress < 1;
    let orbitDestination = want.clone();
    let desiredLookTarget = chaseTarget.clone();
    if (hasMouseView) {
        const baseOffset = want.clone().sub(mouseTarget);
        const baseYaw = Math.atan2(baseOffset.x, baseOffset.z);
        const basePitch = Math.asin(clamp(baseOffset.y / Math.max(baseOffset.length(), 1e-4), -1, 1));
        // Give mouse-look a much wider orbit than the tight driving camera.
        const orbitDistance = Math.max(baseOffset.length() * 1.65, 14.5);
        const orbitYaw = baseYaw + mouseLookYaw;
        const orbitPitch = clamp(basePitch + mouseLookPitch, -0.35, 1.12);
        const horizontalDistance = Math.cos(orbitPitch) * orbitDistance;
        orbitDestination = mouseTarget.clone().add(createVector(Math.sin(orbitYaw) * horizontalDistance, Math.sin(orbitPitch) * orbitDistance, Math.cos(orbitYaw) * horizontalDistance));
        orbitDestination.y = Math.max(orbitDestination.y, getSurfaceHeight(orbitDestination.x, orbitDestination.z) + 1.2);
        desiredLookTarget = mouseTarget.clone();
        // When actually inside the tunnel, keep the orbit camera inside the lining.
        const carTunnelDX = p.x - TUNNEL.x;
        const carTunnelDY = p.y - TUNNEL.y;
        const carTunnelRadius = Math.hypot(carTunnelDX, carTunnelDY);
        const carIsInsideTunnel = p.z > TUNNEL.z0 && p.z < TUNNEL.z1
            && carTunnelRadius < TUNNEL.radius + 1.8;
        if (carIsInsideTunnel) {
            const dx = orbitDestination.x - TUNNEL.x;
            const dy = orbitDestination.y - TUNNEL.y;
            const radialDistance = Math.hypot(dx, dy);
            const allowedRadius = TUNNEL.radius - 0.8;
            if (radialDistance > allowedRadius) {
                const scale = allowedRadius / radialDistance;
                orbitDestination.x = TUNNEL.x + dx * scale;
                orbitDestination.y = TUNNEL.y + dy * scale;
            }
        }
    }
    let cameraDestination = want;
    if (mouseLookActive || mouseLookHold) {
        cameraDestination = orbitDestination;
    }
    else if (mouseReturnProgress < 1) {
        const eased = mouseReturnProgress * mouseReturnProgress * (3 - 2 * mouseReturnProgress);
        cameraDestination = orbitDestination.clone().lerp(want, eased);
        desiredLookTarget = mouseTarget.clone().lerp(chaseTarget, eased);
        if (mouseReturnProgress >= 1) {
            mouseLookYaw = 0;
            mouseLookPitch = 0;
        }
    }
    if (!cameraLookTarget)
        cameraLookTarget = desiredLookTarget.clone();
    else
        cameraLookTarget.lerp(desiredLookTarget, 1 - Math.exp(-7 * dt));
    // Normal chase follows at the original responsive speed; orbit view stays responsive too.
    const cameraFollowSpeed = hasMouseView ? 8 : 6;
    camera.position.lerp(cameraDestination, 1 - Math.exp(-cameraFollowSpeed * dt));
    vehicleState.shake *= Math.exp(-5 * dt);
    camera.position.add(createVector(randomOffset(vehicleState.shake), randomOffset(vehicleState.shake), randomOffset(vehicleState.shake)));
    camera.lookAt(cameraLookTarget);
    camera.fov = 58 + Math.min(spd, 80) * .075 + vehicleState.tl * 3.0;
    camera.updateProjectionMatrix();
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
selectScenario(0);
camera.position.set(-6, 4, -40);
(function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(.05, (t - previousFrameTime) / 1000);
    previousFrameTime = t;
    if (gameRunning) {
        simulationAccumulator += dt;
        while (simulationAccumulator >= 1 / 120) {
            updatePhysics(1 / 120);
            simulationAccumulator -= 1 / 120;
        }
    }
    renderFrame(dt);
    renderer.render(scene, camera);
})(previousFrameTime);
