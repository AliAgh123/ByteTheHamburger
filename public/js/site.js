import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const { gsap, ScrollTrigger, Lenis } = window;
gsap.registerPlugin(ScrollTrigger);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = THREE.MathUtils.lerp;

let lenis;
if (!reduceMotion) {
	lenis = new Lenis({ lerp: 0.09 });
	lenis.on('scroll', ScrollTrigger.update);
	gsap.ticker.add((time) => lenis.raf(time * 1000));
	gsap.ticker.lagSmoothing(0);
}

document.querySelectorAll('a[href^="/#"], a[href^="#"]').forEach((a) => {
	a.addEventListener('click', (e) => {
		const target = document.querySelector(a.getAttribute('href').replace(/^\//, ''));
		if (!target) return;
		e.preventDefault();
		if (lenis) lenis.scrollTo(target, { offset: -40 });
		else target.scrollIntoView();
	});
});

ScrollTrigger.create({
	start: 'top -60',
	end: 'max',
	toggleClass: { className: 'is-solid', targets: '.nav' },
});

const canvas = document.querySelector('.build-canvas');
if (canvas) buildHero(canvas);
else document.body.classList.add('is-loaded');
sectionAnimations();

function buildHero(canvas) {
	// Bottom to top. `match` is tested against the node names in the model.
	const LAYERS = [
		{ match: /down/i, name: 'Toasted bottom bun', note: 'Brushed with butter' },
		{ match: /green/i, name: 'Butter lettuce', note: 'Washed this morning' },
		{ match: /meat/i, name: 'Beef patty', note: 'Smashed on a hot grill' },
		{ match: /plane/i, name: 'Cheddar', note: 'Melted over the patty' },
		{ match: /tomato/i, name: 'Tomato', note: 'Four thick slices' },
		{ match: /up/i, name: 'Sesame top bun', note: 'Baked every morning' },
	];

	const stage = canvas.closest('.build-stage');
	const tagsEl = stage.querySelector('.build-tags');
	const hudNow = stage.querySelector('.hud-now');
	const hudName = stage.querySelector('.hud-name');

	const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	// No tone mapping: the model's flat colours wash out under ACES and AgX.
	renderer.toneMapping = THREE.NoToneMapping;

	const scene = new THREE.Scene();
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

	const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

	const key = new THREE.DirectionalLight(0xfff1dc, 1.6);
	key.position.set(4, 7, 6);
	const rim = new THREE.DirectionalLight(0xff8a2a, 3.5);
	rim.position.set(-6, 3, -6);
	const fill = new THREE.HemisphereLight(0xffe7c4, 0x2a1406, 0.35);
	scene.add(key, rim, fill);

	// place: layout position. tilt: follows the pointer. spin: turns with the scroll.
	const place = new THREE.Group();
	const tilt = new THREE.Group();
	const spin = new THREE.Group();
	place.add(tilt);
	tilt.add(spin);
	scene.add(place);

	const shadowTexture = (() => {
		const c = document.createElement('canvas');
		c.width = c.height = 256;
		const g = c.getContext('2d');
		const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
		grad.addColorStop(0, 'rgba(0,0,0,0.85)');
		grad.addColorStop(0.5, 'rgba(0,0,0,0.35)');
		grad.addColorStop(1, 'rgba(0,0,0,0)');
		g.fillStyle = grad;
		g.fillRect(0, 0, 256, 256);
		return new THREE.CanvasTexture(c);
	})();
	const shadow = new THREE.Mesh(
		new THREE.PlaneGeometry(1, 1),
		new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
	);
	shadow.rotation.x = -Math.PI / 2;
	tilt.add(shadow);

	// Scroll-driven values. GSAP tweens these, the render loop reads them.
	const motion = { push: 0, spin: 0, tags: 0 };
	const layout = {};
	const pointer = { x: 0, y: 0 };
	window.addEventListener('pointermove', (e) => {
		pointer.x = e.clientX / window.innerWidth - 0.5;
		pointer.y = e.clientY / window.innerHeight - 0.5;
	});

	function resize() {
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		const wide = w / h > 1.1;
		Object.assign(layout, wide
			? { endX: 2.2, endY: -0.1, dist: 19.5 }
			: { endX: 0, endY: 1.6, dist: 40 });
		// Phones: push the parts further up and down, away from the headline.
		layout.spreadX = wide ? 1 : 0.9;
		layout.spreadY = wide ? 1 : 1.12;
	}
	window.addEventListener('resize', resize);
	resize();

	const layers = [];
	const loaderCount = document.querySelector('.loader-count');

	new GLTFLoader().load(
		'/models/withanimation.glb',
		(gltf) => {
			setup(gltf.scene);
			start();
		},
		(xhr) => {
			if (xhr.total) loaderCount.textContent = Math.round((xhr.loaded / xhr.total) * 100);
		},
	);

	function setup(root) {
		root.scale.setScalar(1.5);
		root.updateMatrixWorld(true);
		let holder = root;
		while (holder.children.length === 1) holder = holder.children[0];

		// Re-parent every part under an untransformed group, keeping its world
		// transform, so offsets below are plain world-space vectors.
		const pieces = new THREE.Group();
		[...holder.children].forEach((p) => pieces.attach(p));
		const centre = new THREE.Box3().setFromObject(pieces).getCenter(new THREE.Vector3());
		const box = new THREE.Box3();

		LAYERS.forEach((def) => {
			const parts = pieces.children.filter((p) => def.match.test(p.name));
			const layerBox = new THREE.Box3();
			parts.forEach((p) => layerBox.union(box.setFromObject(p)));
			layers.push({ ...def, parts, box: layerBox, state: { k: 1 } });
		});
		layers.sort((a, b) => a.box.getCenter(new THREE.Vector3()).y - b.box.getCenter(new THREE.Vector3()).y);

		// Where each part waits before it is assembled: x and y as fractions of
		// the half screen (so the layout follows the viewport), z as depth.
		// Bottom to top; the tomato layer has four slices.
		const SCATTER = [
			[[0.56, -0.5, 0.4]],
			[[-0.6, 0.4, -2]],
			[[-0.52, -0.5, 0.8]],
			[[0.62, 0.34, -1.2]],
			[[-0.28, 0.66, -3], [0.2, -0.7, 0], [0.84, -0.06, -2.5], [-0.86, -0.06, -1]],
			[[0.16, 0.5, -2]],
		];
		layers.forEach((layer, i) => {
			layer.centre = layer.box.getCenter(new THREE.Vector3()).sub(centre);
			layer.radius = (layer.box.max.x - layer.box.min.x) / 2;
			layer.side = SCATTER[i][0][0] < 0 ? -1 : 1;
			layer.parts.forEach((p, j) => {
				// The part's centre in its own space: it moves when the part tumbles.
				const own = p.worldToLocal(box.setFromObject(p).getCenter(new THREE.Vector3()));
				p.position.sub(centre);
				const tumble = (n) => Math.sin(i * 12.9898 + j * 78.233 + n) * 0.5 + 0.5;
				p.userData = {
					rest: { pos: p.position.clone(), rot: p.rotation.clone() },
					own,
					scatter: new THREE.Vector3(...SCATTER[i][j]),
					turn: new THREE.Vector3(1 + tumble(1) * 1.4, (1.5 + tumble(2) * 2) * layer.side, (0.4 + tumble(3)) * -layer.side),
					phase: i * 1.7 + j * 0.9,
				};
				spin.add(p);
				p.traverse((m) => {
					if (!m.isMesh) return;
					m.material.envMapIntensity = 0.35;
					const name = m.material.name;
					if (name === 'tomato') m.material.roughness = 0.22;
					if (name === 'green') m.material.roughness = 0.35;
					if (name === 'meat') {
						m.material.roughness = 0.6;
						m.material.color.set(0x6b3018);
					}
					if (name === 'chees') m.material.roughness = 0.4;
				});
			});

			const tag = document.createElement('div');
			tag.className = 'tag' + (layer.side < 0 ? ' is-left' : '');
			tag.innerHTML = `<span class="tag-line"></span><span>${layer.name}<small>${layer.note}</small></span>`;
			tagsEl.appendChild(tag);
			layer.tag = tag;
		});

		const bottom = layers[0];
		layout.floor = bottom.centre.y - (bottom.box.max.y - bottom.box.min.y) / 2 - 0.02;
		layout.width = bottom.radius * 2;
		layout.height = layers[layers.length - 1].box.max.y - bottom.box.min.y;
	}

	const clock = new THREE.Clock();
	const point = new THREE.Vector3();
	const camRight = new THREE.Vector3();
	const above = new THREE.Vector3();
	const away = new THREE.Vector3();
	const yAxis = new THREE.Vector3(0, 1, 0);
	const centreOffset = (p, out) => out.copy(p.userData.own).multiply(p.scale).applyQuaternion(p.quaternion);
	const shift = new THREE.Vector3();
	const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

	function pose(t) {
		place.position.x = mix(0, layout.endX, motion.push);
		place.position.y = mix(0, layout.endY, motion.push);
		spin.rotation.y = motion.spin + 0.35;
		tilt.rotation.x += (pointer.y * 0.2 - tilt.rotation.x) * 0.05;
		tilt.rotation.y += (pointer.x * 0.35 - tilt.rotation.y) * 0.05;

		const dist = mix(layout.dist, layout.dist * 0.62, motion.push);
		camera.position.set(0, mix(2.6, 2.4, motion.push), dist);
		camera.lookAt(0, mix(0, -0.15, motion.push), 0);

		const drift = reduceMotion ? 0 : 1;
		layers.forEach((layer) => {
			const k = layer.state.k;
			layer.parts.forEach((p) => {
				const { rest, scatter, turn, phase } = p.userData;
				const wobble = (Math.sin(t * 0.7 + phase) * 0.35 + t * 0.15) * drift * k;
				p.rotation.set(
					rest.rot.x + turn.x * k + wobble * 0.4,
					rest.rot.y + turn.y * k + wobble,
					rest.rot.z + turn.z * k,
				);
				// Scattered spot in screen fractions, turned back into the spinning
				// group's space so it stays put on screen while the burger turns.
				const halfH = tanHalfFov * (layout.dist - scatter.z);
				away.set(
					scatter.x * layout.spreadX * halfH * camera.aspect,
					scatter.y * layout.spreadY * halfH + Math.sin(t * 1.1 + phase) * 0.15 * drift,
					scatter.z,
				).applyAxisAngle(yAxis, -spin.rotation.y);
				// Place the part's centre, not its origin, on that spot.
				away.sub(centreOffset(p, shift));
				// Fly along a curve that drops onto the stack from above, so a
				// part never cuts through the layers already in place.
				above.copy(rest.pos).y += layout.height * 1.6;
				const a = (1 - k) * (1 - k);
				const b = 2 * k * (1 - k);
				const c = k * k;
				p.position.set(
					a * rest.pos.x + b * above.x + c * away.x,
					a * rest.pos.y + b * above.y + c * away.y,
					a * rest.pos.z + b * above.z + c * away.z,
				);
			});
		});

		const built = 1 - layers.reduce((s, l) => s + l.state.k, 0) / layers.length;
		shadow.position.y = layout.floor;
		shadow.scale.setScalar(layout.width * mix(0.6, 1.9, built));
		shadow.material.opacity = mix(0, 0.85, built);
	}

	function placeTags() {
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		camRight.setFromMatrixColumn(camera.matrixWorld, 0);
		layers.forEach((layer) => {
			const p = layer.parts[0];
			centreOffset(p, point).add(p.position);
			spin.localToWorld(point);
			point.project(camera);
			const cx = (point.x * 0.5 + 0.5) * w;
			const y = Math.min(h - 24, Math.max(80, (-point.y * 0.5 + 0.5) * h));
			// Point outwards, unless the label would run off the screen.
			let side = layer.side;
			if (side < 0 && cx < 360) side = 1;
			if (side > 0 && cx > w - 360) side = -1;
			const x = cx + side * Math.min(140, w * 0.08);
			layer.tag.classList.toggle('is-left', side < 0);
			layer.tag.style.transform = `translate(${x}px, ${y}px) translate(${side < 0 ? '-100%' : '0'}, -50%)`;
			// A label shows only while its part is flying in, after the headline has gone.
			layer.tag.style.opacity = motion.tags * clamp01(Math.min(layer.state.k - 0.08, 0.95 - layer.state.k) * 6);
		});
	}

	renderer.setAnimationLoop(() => {
		if (!layers.length) return;
		pose(clock.getElapsedTime());
		renderer.render(scene, camera);
		placeTags();
	});

	function start() {
		const intro = gsap.timeline({ onStart: () => document.body.classList.add('is-loaded') });
		intro
			.to('.loader', { yPercent: -100, duration: 0.9, ease: 'expo.inOut' })
			.from('.build-intro .line > span', { yPercent: 110, duration: 1.1, stagger: 0.1, ease: 'expo.out' }, '-=0.35')
			.from('.build-intro .eyebrow, .build-intro .lede', { autoAlpha: 0, y: 20, duration: 0.8, stagger: 0.1 }, '<0.2')
			.from(spin.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 1.6, ease: 'expo.out' }, '<-0.2')
			.to(motion, { tags: 1, duration: 0.8 }, '-=1')
			.from('.build-hud, .scroll-cue', { autoAlpha: 0, duration: 0.6 }, '<');

		// With reduced motion the page still assembles, but only as the visitor
		// scrolls: no intro fly-in, no smooth scrolling and no idle drift.
		if (reduceMotion) intro.progress(1);

		const landAt = (i) => 0.8 + i * 1.05;
		const tl = gsap.timeline({
			defaults: { ease: 'power2.inOut' },
			scrollTrigger: {
				trigger: '.build',
				start: 'top top',
				end: '+=420%',
				pin: stage,
				scrub: 1.2,
			},
			// Runs on the scrubbed time, so the counter matches what is on screen.
			onUpdate: () => {
				const i = Math.min(layers.length - 1, Math.max(0, Math.floor((tl.time() - landAt(0) + 0.5) / 1.05)));
				hudNow.textContent = String(i + 1).padStart(2, '0');
				hudName.textContent = layers[i].name;
			},
		});

		tl.to('.build-intro .line > span', { yPercent: -110, duration: 0.8, stagger: 0.06, ease: 'power3.in' }, 0)
			.to('.build-intro .eyebrow, .build-intro .lede', { autoAlpha: 0, duration: 0.5 }, 0)
			// fromTo, because the load animation also fades these in.
			.fromTo('.scroll-cue', { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.5, immediateRender: false }, 0);
		layers.forEach((layer, i) => {
			tl.to(layer.state, { k: 0, duration: 1.5, ease: 'power2.inOut' }, landAt(i));
		});
		const built = landAt(layers.length - 1) + 1.5;
		tl.to(motion, { spin: Math.PI * 2, duration: 3.2, ease: 'power2.inOut' }, built - 1.6)
			.to('.hud-bar span', { scaleX: 1, duration: built, ease: 'none' }, 0)
			.to('.build-glow', { opacity: 1, scale: 1.35, duration: built }, 0)
			.to(motion, { push: 1, duration: 1.6, ease: 'power3.inOut' }, built - 0.2)
			.fromTo('.build-hud', { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.5, immediateRender: false }, built)
			.fromTo('.build-outro', { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 1, ease: 'power3.out' }, built + 0.6)
			.to({}, { duration: 0.8 });

		stage.querySelectorAll('.build-word').forEach((el) => {
			tl.fromTo(el, { xPercent: el.dataset.dir > 0 ? -30 : 0 }, { xPercent: el.dataset.dir > 0 ? 0 : -30, ease: 'none', duration: tl.duration() }, 0);
		});
	}
}

function sectionAnimations() {
	if (reduceMotion) return;

	document.querySelectorAll('.reveal-words').forEach((el) => {
		const words = [];
		el.childNodes.forEach((node) => {
			const parts = node.nodeType === 3 ? node.textContent.split(/(\s+)/) : [node.outerHTML];
			parts.forEach((w) => words.push(/^\s+$/.test(w) || !w ? w : `<span class="line" style="display:inline-block"><span style="display:inline-block">${w}</span></span>`));
		});
		el.innerHTML = words.join('');
		gsap.from(el.querySelectorAll('.line > span'), {
			yPercent: 110,
			duration: 1,
			stagger: 0.06,
			ease: 'expo.out',
			scrollTrigger: { trigger: el, start: 'top 85%' },
		});
	});

	if (!document.querySelector('.menu')) return;

	gsap.from('.menu-card', {
		y: 60,
		autoAlpha: 0,
		duration: 0.9,
		stagger: { each: 0.08, grid: 'auto' },
		ease: 'power3.out',
		scrollTrigger: { trigger: '.menu-grid', start: 'top 80%' },
	});

	gsap.from('.how-step', {
		y: 50,
		autoAlpha: 0,
		duration: 0.9,
		stagger: 0.15,
		ease: 'power3.out',
		scrollTrigger: { trigger: '.how-steps', start: 'top 80%' },
	});
	gsap.to('.how-line span', {
		scaleX: 1,
		ease: 'none',
		scrollTrigger: { trigger: '.how', start: 'top 70%', end: 'bottom 70%', scrub: true },
	});

	// The two words slide in from opposite sides and meet when the section is centred.
	gsap.utils.toArray('[data-speed]').forEach((el) => {
		gsap.from(el, {
			xPercent: -80 * el.dataset.speed,
			ease: 'none',
			scrollTrigger: { trigger: el.closest('section'), start: 'top bottom', end: 'center center', scrub: true },
		});
	});

	gsap.fromTo('.footer-word', { xPercent: 8 }, {
		xPercent: -8,
		ease: 'none',
		scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'bottom bottom', scrub: true },
	});
}
