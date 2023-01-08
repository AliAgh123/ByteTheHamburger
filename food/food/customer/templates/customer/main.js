import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';


// Setup

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#bg'),
  alpha:true
});

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth*0.47, window.innerHeight*0.6);
camera.position.setZ(10,10,10);

renderer.outputEncoding = THREE.sRGBEncoding;


renderer.render(scene, camera);


// load the hamburger 
const loader = new GLTFLoader();
var model;
let mixer;
loader.load(
	// resource URL
	'/withanimation.glb',
	function ( gltf ) {
    gltf.scene.scale.set(4,4,4);
    gltf.scene.position.set(0, -3, 0);
    model = gltf.scene;
	scene.add(model);
    const clips = gltf.animations;
    mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(clips[0]);
    action.play();
	},
	// called while loading is progressing
	function ( xhr ) {

		console.log( ( xhr.loaded / xhr.total * 100 ) + '% loaded' );

	},
	// called when loading has errors
	function ( error ) {
   
		console.log( 'An error happened' );

	}
);



// Lights

const pointLight = new THREE.PointLight(0xffffff);
pointLight.position.set(5, 5, 5);

const ambientLight = new THREE.AmbientLight(0xffffff);
scene.add(pointLight, ambientLight);

// Helpers

// const lightHelper = new THREE.PointLightHelper(pointLight)
// const gridHelper = new THREE.GridHelper(200, 50);
// scene.add(lightHelper, gridHelper)

// const controls = new OrbitControls(camera, renderer.domElement);


// Scroll Animation

// function moveCamera() {
//   const t = document.body.getBoundingClientRect().top;
 

//   camera.position.z = t * -0.01;
//   camera.position.x = t * -0.0002;
//   camera.rotation.y = t * -0.0002;
// }

// document.body.onscroll = moveCamera;
// moveCamera();

// Animation Loop

const clock = new THREE.Clock();
function animate() {
    if(mixer)
        mixer.update(clock.getDelta());
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.addEventListener('resize', function() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth*0.47, window.innerHeight*0.6);
	renderer.render(scene, camera);
});