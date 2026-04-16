/**
 * ═══════════════════════════════════════════════════════════
 * SPYRO FANS — Industrial HVLS Fan Website
 * script.js
 *
 * Architecture:
 *   - #hero-canvas    : inline 2-column CSS grid, right column
 *   - #config-canvas  : lazy-init via IntersectionObserver
 *
 * Dependencies:
 *   - Three.js (importmap → jsdelivr)
 *   - GSAP + ScrollTrigger (UMD, loaded before importmap)
 * ═══════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ─────────────────────────────────────────────────────────
   GSAP guard — loaded as UMD scripts BEFORE this module
───────────────────────────────────────────────────────── */
const gsap = window.gsap || null;
const ST   = window.ScrollTrigger || null;
if (gsap && ST) { gsap.registerPlugin(ST); }

/* ─────────────────────────────────────────────────────────
   Module-level state
───────────────────────────────────────────────────────── */
let sharedGltf = null;

let heroScene, heroCamera, heroRenderer, heroFan;
let configScene, configCamera, configRenderer, configFan, configControls;
let configInited     = false;
let configAutoRotate = true;
let configIdleTimer  = null;

let heroTargetSpeed = 0.004;
let heroSpeed       = 0;
let configTargetSpeed = 0.015;
let configSpeed       = 0;

let heroClock   = new THREE.Clock();
let configClock = new THREE.Clock();

/* ═══════════════════════════════════════════════════════════
   THEME
═══════════════════════════════════════════════════════════ */

function applyTheme(dark) {
  const html = document.documentElement;
  html.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem('spyro-theme', dark ? 'dark' : 'light');

  /* Update Three.js scene colours if scenes are ready */
  if (heroScene) {
    if (heroScene.background) {
      heroScene.background.set(dark ? 0x050816 : 0xf0f2f8);
    }
    if (heroScene.fog) {
      heroScene.fog.color.set(dark ? 0x050816 : 0xf0f2f8);
    }
  }
  if (configScene && configScene.fog) {
    configScene.fog.color.set(dark ? 0x080d1e : 0xe8eaf4);
  }
}

function initTheme() {
  const saved = localStorage.getItem('spyro-theme');
  const dark  = saved !== 'light';
  applyTheme(dark);

  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', function () {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      applyTheme(!isDark);
    });
  }
}


/* ═══════════════════════════════════════════════════════════
   LOADING SCREEN — pure CSS transition, no GSAP dependency
═══════════════════════════════════════════════════════════ */

function setProgress(pct) {
  var fill = document.getElementById('loader-fill');
  if (fill) {
    fill.style.width = (pct * 100).toFixed(1) + '%';
  }
}

function hideLoader() {
  var loader = document.getElementById('loader');
  if (!loader) { return; }
  /* Pure CSS transition — class carries the opacity:0 + visibility:hidden */
  loader.style.transition = 'opacity 0.6s ease, visibility 0.6s ease';
  loader.style.opacity    = '0';
  setTimeout(function () {
    loader.classList.add('loader-hidden');
  }, 650);
}


/* ═══════════════════════════════════════════════════════════
   MODEL LOADING
═══════════════════════════════════════════════════════════ */

function loadModel() {
  return new Promise(function (resolve, reject) {
    var loader = new GLTFLoader();
    loader.load(
      './fan.glb',
      function (gltf) {
        console.log('[Spyro] fan.glb loaded successfully');
        resolve(gltf);
      },
      function (xhr) {
        if (xhr.lengthComputable) {
          var pct = xhr.loaded / xhr.total;
          setProgress(0.05 + pct * 0.85);
        }
      },
      function (err) {
        console.error('[Spyro] Failed to load fan.glb', err);
        reject(err);
      }
    );
  });
}

/* Centre a model on its bounding box and return the box */
function centerModel(model) {
  var box    = new THREE.Box3().setFromObject(model);
  var center = new THREE.Vector3();
  box.getCenter(center);
  model.position.sub(center);
  return box;
}

/* Detect primary rotation axis from bounding box dimensions */
function detectAxis(box) {
  var size = new THREE.Vector3();
  box.getSize(size);
  /* If Y is much thinner than X and Z → fan is lying flat → rotate Y */
  if (size.y < size.x * 0.5 && size.y < size.z * 0.5) {
    return 'y';
  }
  return 'z';
}

/* Deep-clone GLTF scene, cloning materials so colours can be changed independently */
function cloneModel(gltf) {
  var clone = gltf.scene.clone(true);
  clone.traverse(function (node) {
    if (node.isMesh && node.material) {
      if (Array.isArray(node.material)) {
        node.material = node.material.map(function (m) { return m.clone(); });
      } else {
        node.material = node.material.clone();
      }
    }
  });
  return clone;
}


/* ═══════════════════════════════════════════════════════════
   HERO SCENE
═══════════════════════════════════════════════════════════ */

function initHeroScene(gltf) {
  var canvas = document.getElementById('hero-canvas');
  if (!canvas) { return; }

  var parent = canvas.parentElement;
  var w = parent ? (parent.clientWidth  || 800) : 800;
  var h = parent ? (parent.clientHeight || 600) : 600;

  /* Renderer */
  heroRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  heroRenderer.setSize(w, h);
  heroRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  heroRenderer.toneMapping         = THREE.ACESFilmicToneMapping;
  heroRenderer.toneMappingExposure = 1.1;
  heroRenderer.outputColorSpace    = THREE.SRGBColorSpace;

  /* Scene */
  var dark = document.documentElement.getAttribute('data-theme') !== 'light';
  heroScene = new THREE.Scene();
  heroScene.background = new THREE.Color(dark ? 0x050816 : 0xf0f2f8);
  heroScene.fog        = new THREE.FogExp2(dark ? 0x050816 : 0xf0f2f8, 0.045);

  /* Camera */
  heroCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  heroCamera.position.set(0, 0.5, 6);
  heroCamera.lookAt(0, 0, 0);

  /* Lights */
  var amb = new THREE.AmbientLight(0xffffff, 0.6);
  heroScene.add(amb);

  var keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
  keyLight.position.set(4, 5, 5);
  heroScene.add(keyLight);

  var fillLight = new THREE.DirectionalLight(0x2563eb, 2.0);
  fillLight.position.set(-4, 2, -3);
  heroScene.add(fillLight);

  var rimLight = new THREE.DirectionalLight(0xff3b3b, 0.8);
  rimLight.position.set(2, -2, 4);
  heroScene.add(rimLight);

  /* Model */
  var modelClone = cloneModel(gltf);
  var box        = centerModel(modelClone);
  var axis       = detectAxis(box);

  heroFan = new THREE.Group();
  heroFan.add(modelClone);
  heroFan.userData.axis = axis;
  heroScene.add(heroFan);

  /* Fit camera to model */
  var size   = new THREE.Vector3();
  box.getSize(size);
  var maxDim = Math.max(size.x, size.y, size.z);
  heroCamera.position.z = maxDim * 2.2;

  /* ResizeObserver */
  if (parent && window.ResizeObserver) {
    var ro = new ResizeObserver(function () {
      var nw = parent.clientWidth  || 800;
      var nh = parent.clientHeight || 600;
      heroCamera.aspect = nw / nh;
      heroCamera.updateProjectionMatrix();
      heroRenderer.setSize(nw, nh);
    });
    ro.observe(parent);
  }

  /* Render loop */
  (function heroLoop() {
    requestAnimationFrame(heroLoop);
    var delta = heroClock.getDelta();
    /* Smooth speed interpolation */
    heroSpeed += (heroTargetSpeed - heroSpeed) * Math.min(1, delta * 3);
    if (heroFan) {
      heroFan.rotation[heroFan.userData.axis] += heroSpeed;
    }
    heroRenderer.render(heroScene, heroCamera);
  }());
}


/* ═══════════════════════════════════════════════════════════
   CONFIG SCENE (lazy, called by IntersectionObserver)
═══════════════════════════════════════════════════════════ */

function initConfigScene(gltf) {
  if (configInited) { return; }
  configInited = true;

  var canvas = document.getElementById('config-canvas');
  if (!canvas) { return; }

  var parent = canvas.parentElement;
  var w = parent ? (parent.clientWidth  || 800) : 800;
  var h = parent ? (parent.clientHeight || 600) : 600;

  /* Renderer */
  configRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  configRenderer.setSize(w, h);
  configRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  configRenderer.toneMapping         = THREE.ACESFilmicToneMapping;
  configRenderer.toneMappingExposure = 1.0;
  configRenderer.outputColorSpace    = THREE.SRGBColorSpace;

  /* Scene */
  var dark = document.documentElement.getAttribute('data-theme') !== 'light';
  configScene = new THREE.Scene();
  configScene.background = new THREE.Color(dark ? 0x080d1e : 0xe8eaf4);
  configScene.fog        = new THREE.FogExp2(dark ? 0x080d1e : 0xe8eaf4, 0.05);

  /* Camera */
  configCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  configCamera.position.set(0, 1.5, 5);
  configCamera.lookAt(0, 0, 0);

  /* Lights */
  var amb = new THREE.AmbientLight(0xffffff, 0.7);
  configScene.add(amb);

  var key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(3, 4, 4);
  configScene.add(key);

  var fill = new THREE.DirectionalLight(0x2563eb, 1.5);
  fill.position.set(-3, 1, -2);
  configScene.add(fill);

  var rim = new THREE.DirectionalLight(0xff3b3b, 0.6);
  rim.position.set(1, -2, 3);
  configScene.add(rim);

  /* Grid helper */
  var grid = new THREE.GridHelper(10, 20, 0x2563eb, 0x2563eb);
  grid.material.opacity    = 0.12;
  grid.material.transparent = true;
  grid.position.y = -1.2;
  configScene.add(grid);

  /* Model */
  var modelClone = cloneModel(gltf);
  var box        = centerModel(modelClone);
  var axis       = detectAxis(box);

  configFan = new THREE.Group();
  configFan.add(modelClone);
  configFan.userData.axis = axis;

  /* Collect all meshes for colour changes */
  var meshes = [];
  modelClone.traverse(function (node) {
    if (node.isMesh) { meshes.push(node); }
  });
  configFan.userData.meshes = meshes;

  /* Fit camera to model */
  var size   = new THREE.Vector3();
  box.getSize(size);
  var maxDim = Math.max(size.x, size.y, size.z);
  configCamera.position.set(0, maxDim * 0.15, maxDim * 2.1);
  configCamera.lookAt(0, 0, 0);

  /* Face fan toward viewer — slight downward tilt so blades are visible */
  configFan.rotation.x = -Math.PI / 6;  /* ~30°: blades tilt toward camera  */
  configFan.rotation.y =  Math.PI / 4;  /* 45° yaw: face diagonal to camera */
  configScene.add(configFan);

  /* OrbitControls — rotate + zoom, no pan */
  configControls = new OrbitControls(configCamera, configRenderer.domElement);
  configControls.enableDamping = true;
  configControls.dampingFactor = 0.08;
  configControls.enablePan     = false;
  configControls.minDistance   = maxDim * 0.8;
  configControls.maxDistance   = maxDim * 4.5;

  /* Stop auto-rotate on interact, resume after 3 s idle */
  configControls.addEventListener('start', function() {
    configAutoRotate = false;
    clearTimeout(configIdleTimer);
  });
  configControls.addEventListener('end', function() {
    configIdleTimer = setTimeout(function() { configAutoRotate = true; }, 3000);
  });

  /* ResizeObserver */
  if (parent && window.ResizeObserver) {
    var ro = new ResizeObserver(function () {
      var nw = parent.clientWidth  || 800;
      var nh = parent.clientHeight || 600;
      configCamera.aspect = nw / nh;
      configCamera.updateProjectionMatrix();
      configRenderer.setSize(nw, nh);
    });
    ro.observe(parent);
  }

  /* Hide fallback */
  var fallback = document.getElementById('config-fallback');
  if (fallback) { fallback.classList.remove('visible'); }

  /* Render loop */
  (function configLoop() {
    requestAnimationFrame(configLoop);
    var delta = configClock.getDelta();

    configSpeed += (configTargetSpeed - configSpeed) * Math.min(1, delta * 3);
    if (configFan) {
      configFan.rotation[configFan.userData.axis] += configSpeed;
    }

    if (configControls) { configControls.update(); }
    configRenderer.render(configScene, configCamera);
  }());
}


/* ═══════════════════════════════════════════════════════════
   SCROLL ANIMATIONS (GSAP + ScrollTrigger)
═══════════════════════════════════════════════════════════ */

function initScrollAnimations() {
  if (!gsap || !ST) { return; }

  /* Hero left text reveal on scroll */
  gsap.fromTo(
    '#hero .hero-left',
    { opacity: 1, y: 0 },
    {
      opacity: 0.3,
      y: -40,
      ease: 'none',
      scrollTrigger: {
        trigger: '#hero',
        start: 'top top',
        end:   'bottom top',
        scrub: true,
      },
    }
  );

  /* Hero camera zoom out slightly on scroll */
  ST.create({
    trigger: '#hero',
    start:   'top top',
    end:     'bottom top',
    scrub:   true,
    onUpdate: function (self) {
      if (heroCamera) {
        var base = heroCamera.userData.baseZ || heroCamera.position.z;
        if (!heroCamera.userData.baseZ) { heroCamera.userData.baseZ = base; }
        heroCamera.position.z = base + self.progress * 2;
      }
    },
  });

  /* Stagger reveal for sections */
  gsap.utils.toArray('.reveal').forEach(function (el) {
    gsap.fromTo(
      el,
      { opacity: 0, y: 30 },
      {
        opacity: 1,
        y: 0,
        duration: 0.7,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 88%',
          toggleActions: 'play none none none',
        },
      }
    );
  });
}


/* ═══════════════════════════════════════════════════════════
   CONFIGURATOR CONTROLS
═══════════════════════════════════════════════════════════ */

function initConfigurator() {
  /* Speed slider */
  var slider     = document.getElementById('speed-slider');
  var rpmDisplay = document.getElementById('rpm-display');

  /* Dynamic spec elements */
  var specNoise   = document.getElementById('spec-noise');
  var specEnergy  = document.getElementById('spec-energy');
  var specTorque  = document.getElementById('spec-torque');
  var specAirflow = document.getElementById('spec-airflow');

  /* Smoothly animate a spec value to a new number */
  function animateSpec(el, toVal, unit, decimals) {
    if (!el) return;
    var fromText = el.textContent.replace(/[^0-9.]/g, '');
    var from     = parseFloat(fromText) || 0;
    var start    = performance.now();
    var dur      = 250;
    (function step(now) {
      var p   = Math.min(1, (now - start) / dur);
      var cur = from + (toVal - from) * p;
      el.textContent = cur.toFixed(decimals) + ' ' + unit;
      if (p < 1) { requestAnimationFrame(step); }
    }(performance.now()));
  }

  /* Recalculate all dynamic specs from RPM value */
  function updateDynSpecs(rpm) {
    animateSpec(specNoise,   30  + (rpm * 0.15), 'dB',      1);
    animateSpec(specEnergy,  0.3 + (rpm * 0.01), 'kW',      2);
    animateSpec(specTorque,  10  + (rpm * 0.2),  'Nm',      1);
    animateSpec(specAirflow, rpm * 20,            'm³/min',  0);

    /* Glow scales with RPM — inset shadow works with overflow:hidden */
    var glow    = rpm / 68;
    var viewer  = document.querySelector('.config-viewer');
    if (viewer) {
      var radius  = Math.round(20 + glow * 70);
      var alpha   = (0.08 + glow * 0.32).toFixed(3);
      viewer.style.boxShadow = 'inset 0 0 ' + radius + 'px rgba(255,59,59,' + alpha + ')';
    }
  }

  if (slider) {
    slider.addEventListener('input', function () {
      var val       = parseFloat(slider.value);
      configTargetSpeed = (val / 100) * 0.06;
      var approxRpm = Math.round((val / 100) * 68);
      if (rpmDisplay) { rpmDisplay.textContent = approxRpm + ' RPM'; }
      updateDynSpecs(approxRpm);
    });
    /* Initialise specs at 0 RPM */
    updateDynSpecs(0);
  }

  /* Colour buttons */
  var picker = document.getElementById('colour-picker');
  if (picker) {
    picker.querySelectorAll('.color-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        /* Update active state */
        picker.querySelectorAll('.color-btn').forEach(function (b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');

        var hex = btn.getAttribute('data-color');
        if (!hex) { return; }

        var newColor = new THREE.Color(hex);

        if (configFan && configFan.userData.meshes) {
          configFan.userData.meshes.forEach(function (mesh) {
            var mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach(function (mat) {
              if (gsap) {
                /* Animate colour transition with GSAP */
                var from = { r: mat.color.r, g: mat.color.g, b: mat.color.b };
                gsap.to(from, {
                  r: newColor.r,
                  g: newColor.g,
                  b: newColor.b,
                  duration: 0.4,
                  ease: 'power2.out',
                  onUpdate: function () {
                    mat.color.setRGB(from.r, from.g, from.b);
                  },
                });
              } else {
                mat.color.set(hex);
              }
            });
          });
        }
      });
    });
  }
}


/* ═══════════════════════════════════════════════════════════
   INTERSECTION OBSERVER — lazy init config scene
═══════════════════════════════════════════════════════════ */

function observeConfig() {
  var section = document.getElementById('configurator');
  if (!section || !window.IntersectionObserver) { return; }

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && sharedGltf && !configInited) {
          initConfigScene(sharedGltf);
          io.disconnect();
        }
      });
    },
    { threshold: 0.1 }
  );

  io.observe(section);
}


/* ═══════════════════════════════════════════════════════════
   REVEAL — IntersectionObserver adds 'visible' class
   (CSS handles the opacity/translateY animation)
═══════════════════════════════════════════════════════════ */

function initReveal() {
  /* Skip if GSAP ScrollTrigger is handling reveals */
  if (gsap && ST) { return; }

  var items = document.querySelectorAll('.reveal');
  if (!items.length || !window.IntersectionObserver) {
    /* Fallback: just show everything */
    items.forEach(function (el) { el.classList.add('visible'); });
    return;
  }

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  items.forEach(function (el) { io.observe(el); });
}


/* ═══════════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════════ */

function initNav() {
  var navbar    = document.getElementById('navbar');
  var hamburger = document.getElementById('nav-hamburger');
  var navLinks  = document.getElementById('nav-links');

  /* Scroll class */
  window.addEventListener('scroll', function () {
    if (navbar) {
      navbar.classList.toggle('scrolled', window.scrollY > 20);
    }
  }, { passive: true });

  /* Hamburger toggle */
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      hamburger.classList.toggle('open', open);
      hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* Smooth scroll for all nav links — close menu after click */
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var href = link.getAttribute('href');
      if (href === '#') { return; }
      var target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
        /* Close mobile menu */
        if (navLinks) { navLinks.classList.remove('open'); }
        if (hamburger) {
          hamburger.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
        }
      }
    });
  });
}


/* ═══════════════════════════════════════════════════════════
   CONTACT FORM
═══════════════════════════════════════════════════════════ */

/* ── API base URL — update to production URL when deployed ── */
var SPYRO_API = 'http://localhost:3001';

function initContact() {
  var form    = document.getElementById('contact-form');
  var success = document.getElementById('form-success');

  if (!form) { return; }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var nameEl    = form.querySelector('#f-name');
    var emailEl   = form.querySelector('#f-email');
    var phoneEl   = form.querySelector('#f-phone');
    var productEl = form.querySelector('#f-product');
    var msgEl     = form.querySelector('#f-msg');

    /* Client-side validation */
    if (!nameEl || !nameEl.value.trim()) {
      nameEl && nameEl.focus();
      return;
    }
    if (!phoneEl || !phoneEl.value.trim()) {
      phoneEl && phoneEl.focus();
      return;
    }

    var btn = form.querySelector('.btn-submit');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.7'; }

    var payload = {
      name:    nameEl.value.trim(),
      phone:   phoneEl  ? phoneEl.value.trim()  : '',
      email:   emailEl  ? emailEl.value.trim()  : '',
      product: productEl ? productEl.value.trim() : '',
      message: msgEl     ? msgEl.value.trim()     : ''
    };

    fetch(SPYRO_API + '/api/new-lead', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.success) {
        if (success) { success.style.display = 'block'; }
        form.reset();
      } else {
        alert(data.message || 'Submission failed. Please try again.');
      }
    })
    .catch(function () {
      /* Graceful fallback: show success even if API is unreachable (dev mode) */
      if (success) { success.style.display = 'block'; }
      form.reset();
    })
    .finally(function () {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    });
  });
}


/* ═══════════════════════════════════════════════════════════
   INIT (async entry point)
═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   HERO CAROUSEL
═══════════════════════════════════════════════════════════ */

const heroSlides = [
  {
    title:    'Roof Fans',
    desc:     'Ceiling-mounted HVLS fans engineered for warehouses, factories, and large open spaces. Deliver powerful, uniform airflow with minimal energy draw.',
    btn:      'Watch Demo',
    btnHref:  'https://youtube.com/',
    media:    'roof1.png',
    type:     'image',
    diameter: '24<small>ft</small>',
    coverage: '2500<small>m²</small>',
    savings:  '90<small>%</small>',
    specs:    [
      'Optimized for large ceiling installations',
      'Energy-efficient low-speed airflow',
      'Whisper-quiet operation',
    ],
  },
  {
    title:    'Floor Fans',
    desc:     'Industrial floor-standing fans built for targeted spot cooling and air circulation in workshops, loading docks, and production lines.',
    btn:      'Watch Demo',
    btnHref:  'https://youtube.com/',
    media:    'floor1.png',
    type:     'image',
    diameter: '18<small>ft</small>',
    coverage: '1800<small>m²</small>',
    savings:  '75<small>%</small>',
    specs:    [
      'Portable & easy to reposition',
      'High-velocity directional airflow',
      'Heavy-duty steel construction',
    ],
  },
  {
    title:    'Pole Fans',
    desc:     'Elevated pole-mount fans for gymnasiums, hangars, and retail environments. Adjustable height for precision airflow coverage.',
    btn:      'Watch Demo',
    btnHref:  'https://youtube.com/',
    media:    'pole1.png',
    type:     'image',
    diameter: '20<small>ft</small>',
    coverage: '2000<small>m²</small>',
    savings:  '80<small>%</small>',
    specs:    [
      'Adjustable pole height up to 5 m',
      'Wide oscillation for maximum reach',
      'Corrosion-resistant aluminium blades',
    ],
  },
  {
    title:    'Airflow System',
    desc:     'See Spyro HVLS technology in action — visualizing how large-diameter, low-speed fans create a consistent, building-wide column of moving air.',
    btn:      'Watch Demo',
    btnHref:  'https://youtube.com/',
    media:    'airflow.mp4',
    type:     'video',
    diameter: '—',
    coverage: 'Wide<small>Area</small>',
    savings:  'Optimized',
    specs:    [
      'Full 360° airflow visualisation',
      'Thermal comfort at half the energy cost',
      'Proven in 1 000+ industrial sites',
    ],
  },
];

function initCarousel() {
  var track    = document.getElementById('carousel-track');
  var progress = document.getElementById('carousel-progress');
  var dotsWrap = document.getElementById('carousel-dots');
  var prevBtn  = document.getElementById('carousel-prev');
  var nextBtn  = document.getElementById('carousel-next');
  var ciTitle  = document.getElementById('ci-title');
  var ciBtn    = document.getElementById('ci-btn');

  /* ci-btn always opens YouTube */
  if (ciBtn) {
    ciBtn.addEventListener('click', function() {
      window.open('https://youtube.com/', '_blank', 'noopener,noreferrer');
    });
  }
  var catName  = document.getElementById('slide-cat-name');
  var specList = document.getElementById('slide-specs-list');
  var slideBtn = document.getElementById('hero-slide-btn');

  if (!track) return;

  var slides   = track.querySelectorAll('.carousel-slide');
  var dots     = dotsWrap ? dotsWrap.querySelectorAll('.c-dot') : [];
  var current  = 0;
  var total    = slides.length;
  var autoTimer  = null;
  var progTimer  = null;
  var paused     = false;
  var INTERVAL   = 4000; /* ms per slide */

  /* Stat elements */
  var statDiameter = document.querySelector('.stat-diameter');
  var statCoverage = document.querySelector('.stat-coverage');
  var statSavings  = document.querySelector('.stat-savings');
  var statEls      = [statDiameter, statCoverage, statSavings];

  /* ── animated stat update: fade out → swap → fade in ─── */
  function updateStats(idx) {
    var s = heroSlides[idx];
    if (!s) return;

    /* Fade out */
    statEls.forEach(function(el) {
      if (el) el.style.opacity = '0';
    });

    /* Swap values after fade-out completes, then fade in */
    setTimeout(function() {
      if (statDiameter) statDiameter.innerHTML = s.diameter;
      if (statCoverage) statCoverage.innerHTML = s.coverage;
      if (statSavings)  statSavings.innerHTML  = s.savings;
      statEls.forEach(function(el) {
        if (el) el.style.opacity = '1';
      });
    }, 300);
  }

  /* ── update left-column dynamic content ─── */
  function updateLeft(idx) {
    var s = heroSlides[idx];
    if (!s) return;

    /* category name */
    if (catName) catName.textContent = s.title;

    /* spec bullets */
    if (specList) {
      specList.innerHTML = s.specs.map(function(sp) {
        return '<li>' + sp + '</li>';
      }).join('');
    }

    /* secondary CTA — always opens YouTube */
    if (slideBtn) {
      slideBtn.textContent = 'Watch Demo';
      slideBtn.href        = 'https://youtube.com/';
      slideBtn.target      = '_blank';
      slideBtn.rel         = 'noopener noreferrer';
    }

    /* stats */
    updateStats(idx);
  }

  /* ── update right overlay ─── */
  function updateOverlay(idx) {
    var s = heroSlides[idx];
    if (!s) return;
    if (ciTitle) {
      ciTitle.style.opacity = '0';
      setTimeout(function() {
        ciTitle.textContent   = s.title;
        ciTitle.style.opacity = '1';
      }, 200);
    }
  }

  /* ── update dot indicators ─── */
  function updateDots(idx) {
    dots.forEach(function(d, i) {
      d.classList.toggle('active', i === idx);
    });
  }

  /* ── goto slide ─── */
  function goTo(idx) {
    if (idx === current) return;

    var prevSlide = slides[current];
    var nextSlide = slides[idx];

    /* determine direction */
    var forward = idx > current || (current === total - 1 && idx === 0);

    /* exit current */
    prevSlide.classList.remove('active');
    prevSlide.classList.add('exit-left');

    /* Kill Ken Burns on the exiting slide */
    if (gsap) {
      var prevMedia = prevSlide.querySelector('.slide-media');
      if (prevMedia) gsap.killTweensOf(prevMedia);
    }

    /* GSAP transition if available, else CSS only */
    if (gsap) {
      gsap.fromTo(
        nextSlide,
        { opacity: 0, x: forward ? 60 : -60 },
        {
          opacity: 1,
          x: 0,
          duration: 0.55,
          ease: 'power2.out',
          onStart: function() {
            nextSlide.classList.add('active');
            /* Ken Burns on the entering slide's image */
            var media = nextSlide.querySelector('.slide-media');
            if (media && media.tagName !== 'VIDEO') {
              gsap.fromTo(media,
                { scale: 1, rotation: 0.6, x: 12 },
                { scale: 1.08, rotation: -0.4, x: -8, duration: 8, ease: 'power1.inOut' }
              );
            }
          },
          onComplete: function() {
            prevSlide.classList.remove('exit-left');
            gsap.set(nextSlide, { clearProps: 'x,opacity' });
          },
        }
      );
    } else {
      nextSlide.style.transform = forward ? 'translateX(60px)' : 'translateX(-60px)';
      nextSlide.style.opacity   = '0';
      nextSlide.classList.add('active');
      requestAnimationFrame(function() {
        nextSlide.style.transition = 'opacity 0.55s ease, transform 0.55s ease';
        nextSlide.style.transform  = 'translateX(0)';
        nextSlide.style.opacity    = '1';
        setTimeout(function() {
          prevSlide.classList.remove('exit-left');
          nextSlide.style.transition = '';
          nextSlide.style.transform  = '';
          nextSlide.style.opacity    = '';
        }, 580);
      });
    }

    /* pause / play video */
    slides.forEach(function(sl, i) {
      var vid = sl.querySelector('video');
      if (vid) {
        if (i === idx) { vid.play && vid.play(); }
        else           { vid.pause && vid.pause(); }
      }
    });

    current = idx;
    updateDots(idx);
    updateLeft(idx);
    updateOverlay(idx);
    resetProgress();
  }

  /* ── progress bar ─── */
  function resetProgress() {
    if (!progress) return;
    progress.style.transition = 'none';
    progress.style.width      = '0%';
    clearTimeout(progTimer);
    if (!paused) {
      requestAnimationFrame(function() {
        progress.style.transition = 'width ' + INTERVAL + 'ms linear';
        progress.style.width      = '100%';
      });
    }
  }

  /* ── auto-advance ─── */
  function startAuto() {
    clearInterval(autoTimer);
    autoTimer = setInterval(function() {
      if (!paused) goTo((current + 1) % total);
    }, INTERVAL);
  }

  function stopAuto() {
    clearInterval(autoTimer);
  }

  /* ── touch / swipe ─── */
  var touchStartX = 0;
  track.addEventListener('touchstart', function(e) {
    touchStartX = e.changedTouches[0].clientX;
  }, { passive: true });
  track.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) {
      if (dx < 0) goTo((current + 1) % total);
      else        goTo((current - 1 + total) % total);
      stopAuto(); startAuto();
    }
  }, { passive: true });

  /* ── button + dot handlers ─── */
  if (prevBtn) {
    prevBtn.addEventListener('click', function() {
      goTo((current - 1 + total) % total);
      stopAuto(); startAuto();
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', function() {
      goTo((current + 1) % total);
      stopAuto(); startAuto();
    });
  }
  dots.forEach(function(d, i) {
    d.addEventListener('click', function() {
      goTo(i);
      stopAuto(); startAuto();
    });
  });

  /* ── hover pause ─── */
  var carousel = document.getElementById('hero-carousel');
  if (carousel) {
    carousel.addEventListener('mouseenter', function() {
      paused = true;
      /* Pause GSAP Ken Burns on current slide */
      if (gsap) {
        var media = slides[current] ? slides[current].querySelector('.slide-media') : null;
        if (media) gsap.getTweensOf(media).forEach(function(t) { t.pause(); });
      }
      if (progress) {
        progress.style.transition = 'none';
        var w  = progress.getBoundingClientRect().width;
        var tw = progress.parentElement ? progress.parentElement.getBoundingClientRect().width : 0;
        progress.style.width = (tw > 0 ? (w / tw * 100) : 0) + '%';
      }
    });
    carousel.addEventListener('mouseleave', function() {
      paused = false;
      /* Resume GSAP Ken Burns on current slide */
      if (gsap) {
        var media = slides[current] ? slides[current].querySelector('.slide-media') : null;
        if (media) gsap.getTweensOf(media).forEach(function(t) { t.resume(); });
      }
      resetProgress();
    });
  }

  /* ── init first slide ─── */
  updateLeft(0);
  updateOverlay(0);
  updateDots(0);
  resetProgress();
  startAuto();

  /* Ken Burns on first slide */
  if (gsap && slides[0]) {
    var firstMedia = slides[0].querySelector('.slide-media');
    if (firstMedia && firstMedia.tagName !== 'VIDEO') {
      gsap.fromTo(firstMedia,
        { scale: 1, rotation: 0.6, x: 12 },
        { scale: 1.08, rotation: -0.4, x: -8, duration: 8, ease: 'power1.inOut' }
      );
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   PRODUCT PREVIEW — click card to update preview panel
═══════════════════════════════════════════════════════════ */
function initProductPreview() {
  var previewImg  = document.getElementById('preview-image');
  var psCoverage  = document.getElementById('ps-coverage');
  var psPower     = document.getElementById('ps-power');
  var psSpeed     = document.getElementById('ps-speed');
  var psName      = document.getElementById('ps-name');

  if (!previewImg) return;

  var grid  = document.querySelector('.products-grid');
  if (!grid) return;

  function updatePreview(card) {
    /* Highlight selected card */
    grid.querySelectorAll('.product-card').forEach(function(c) {
      c.classList.remove('active');
    });
    card.classList.add('active');

    /* Fade out → swap → fade in */
    previewImg.style.opacity = '0';
    var specEls = [psCoverage, psPower, psSpeed, psName];
    specEls.forEach(function(el) { if (el) el.style.opacity = '0'; });

    setTimeout(function() {
      previewImg.src = card.dataset.img || previewImg.src;
      previewImg.onerror = function() {
        this.src = card.dataset.imgFb || '';
      };
      if (psCoverage) psCoverage.textContent = card.dataset.coverage || '';
      if (psPower)    psPower.textContent    = card.dataset.power    || '';
      if (psSpeed)    psSpeed.textContent    = card.dataset.speed    || '';
      if (psName)     psName.textContent     = card.dataset.name     || '';

      previewImg.style.opacity = '1';
      specEls.forEach(function(el) { if (el) el.style.opacity = '1'; });
    }, 300);
  }

  /* Single delegated listener on grid */
  grid.addEventListener('click', function(e) {
    var card = e.target.closest('.product-card[data-img]');
    if (card) updatePreview(card);
  });
}


/* ═══════════════════════════════════════════════════════════
   FAN SELECTOR — shared factory for floor + pole sections
═══════════════════════════════════════════════════════════ */
function initFanSelector(prefix, fanData, sectionSel) {
  var imgEl   = document.getElementById(prefix + '-preview-img');
  var section = document.querySelector(sectionSel || ('#' + prefix + '-fans'));

  if (!imgEl || !section) return;

  function fadeImage(src) {
    imgEl.style.opacity = '0';
    setTimeout(function() {
      imgEl.src = src;
      imgEl.style.opacity = '1';
    }, 350);
  }

  function updateSpecs(modelKey) {
    var data = fanData[modelKey];
    if (!data) return;
    Object.keys(data).forEach(function(key) {
      if (key === 'img') return;
      var el = document.getElementById(prefix + '-s-' + key);
      if (el) {
        el.style.opacity = '0';
        var val = data[key];
        setTimeout(function() {
          el.textContent   = val;
          el.style.opacity = '1';
        }, 250);
      }
    });
  }

  /* Single delegated listener for the whole section */
  section.addEventListener('click', function(e) {
    /* Model / size tabs */
    var tab = e.target.closest('.fs-tab');
    if (tab && !tab.classList.contains('active')) {
      var tabGroup = tab.closest('[data-fan][data-type]');
      if (!tabGroup) return;

      tabGroup.querySelectorAll('.fs-tab').forEach(function(t) {
        t.classList.remove('active');
      });
      tab.classList.add('active');

      if (tabGroup.dataset.type === 'model') {
        var modelKey = tab.dataset.value;
        var d = fanData[modelKey];
        if (d) fadeImage(d.img);
        updateSpecs(modelKey);
      }
      return;
    }

    /* Color swatches */
    var swatch = e.target.closest('.fs-color');
    if (swatch) {
      var colorGroup = swatch.closest('.fs-group');
      colorGroup.querySelectorAll('.fs-color').forEach(function(c) {
        c.classList.remove('active');
      });
      swatch.classList.add('active');
      var nameEl = colorGroup.querySelector('.fs-color-name');
      if (nameEl) nameEl.textContent = swatch.dataset.color || '';
    }
  });

  /* Init first model specs */
  updateSpecs('model1');
}

function initFanSelectors() {
  /* ── HVLS ceiling fans (uses #products section) ── */
  var hvlsFans = {
    spyro24: { img: 'spyro24.jpg', model: 'Spyro 24', diameter: '7.3 m / 24 ft', coverage: '2,500 m²', power: '1.5 kW', speed: '68 RPM'  },
    spyro20: { img: 'spyro20.jpg', model: 'Spyro 20', diameter: '6.1 m / 20 ft', coverage: '1,800 m²', power: '1.1 kW', speed: '80 RPM'  },
    spyro18: { img: 'spyro18.jpg', model: 'Spyro 18', diameter: '5.5 m / 18 ft', coverage: '1,400 m²', power: '0.75 kW', speed: '90 RPM' },
    spyro16: { img: 'spyro16.jpg', model: 'Spyro 16', diameter: '4.9 m / 16 ft', coverage: '1,000 m²', power: '0.55 kW', speed: '95 RPM' },
    spyro12: { img: 'spyro12.jpg', model: 'Spyro 12', diameter: '3.7 m / 12 ft', coverage: '600 m²',   power: '0.37 kW', speed: '120 RPM' },
  };

  /* ── Floor fans ── */
  var floorFans = {
    model1: { img: 'floor1.png', model: 'Pro 1800',  airflow: '1,800 m³/h', motor: '0.55 kW', noise: '52 dB' },
    model2: { img: 'floor2.png', model: 'Pro 2200',  airflow: '2,200 m³/h', motor: '0.75 kW', noise: '54 dB' },
    model3: { img: 'floor3.png', model: 'Max 2800',  airflow: '2,800 m³/h', motor: '1.10 kW', noise: '58 dB' },
  };

  /* ── Pole fans ── */
  var poleFans = {
    model1: { img: 'pole1.png',  model: 'Elevate 300', airflow: '1,600 m³/h', motor: '0.37 kW', noise: '48 dB' },
    model2: { img: 'pole2.png',  model: 'Elevate 450', airflow: '2,100 m³/h', motor: '0.55 kW', noise: '51 dB' },
    model3: { img: 'pole3.png',  model: 'Elevate 600', airflow: '2,600 m³/h', motor: '0.75 kW', noise: '55 dB' },
  };

  initFanSelector('hvls',  hvlsFans,  '#products');
  initFanSelector('floor', floorFans);
  initFanSelector('pole',  poleFans);

  /* ── Scroll-in entry animation for HVLS preview image (fires ONCE) ── */
  var hvlsImg = document.getElementById('hvls-preview-img');
  if (hvlsImg) {
    if (gsap && ST) {
      gsap.fromTo(hvlsImg,
        { scale: 0.95, rotation: -2, opacity: 0 },
        {
          scale: 1, rotation: 0, opacity: 1,
          duration: 0.8, ease: 'power2.out',
          /* Clear inline styles after animation so CSS :hover takes over */
          clearProps: 'transform,opacity',
          scrollTrigger: {
            trigger: hvlsImg,
            start:   'top 82%',
            once:    true,
          },
        }
      );
    } else {
      /* IntersectionObserver fallback */
      hvlsImg.style.transform  = 'scale(0.95) rotate(-2deg)';
      hvlsImg.style.opacity    = '0';
      hvlsImg.style.transition = 'transform 0.8s ease, opacity 0.8s ease';
      var hvlsObs = new IntersectionObserver(function(entries, observer) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            hvlsImg.style.transform = 'scale(1) rotate(0deg)';
            hvlsImg.style.opacity   = '1';
            observer.disconnect();
            /* Remove transition after animation so CSS hover works cleanly */
            setTimeout(function() {
              hvlsImg.style.transition = '';
              hvlsImg.style.transform  = '';
              hvlsImg.style.opacity    = '';
            }, 900);
          }
        });
      }, { threshold: 0.15 });
      hvlsObs.observe(hvlsImg);
    }
  }
}

async function init() {
  initTheme();
  initNav();
  initContact();
  initCarousel();
  initFanSelectors();

  try {
    setProgress(0.05);
    sharedGltf = await loadModel();
    setProgress(0.95);

    initHeroScene(sharedGltf);
    setProgress(1.0);

    setTimeout(hideLoader, 400);

    initScrollAnimations();
    initConfigurator();
    observeConfig();
    initReveal();

    /* Hero entrance animation */
    if (gsap) {
      var heroChildren = document.querySelectorAll('.hero-left > *');
      gsap.fromTo(
        heroChildren,
        { opacity: 0, y: 24 },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          stagger: 0.1,
          ease: 'power2.out',
          delay: 0.3,
        }
      );
    }

  } catch (err) {
    console.error('[Spyro] 3D initialisation failed:', err);

    /* Show fallback image, hide canvas */
    var heroCanvas   = document.getElementById('hero-canvas');
    var heroFallback = document.getElementById('hero-fallback');
    if (heroCanvas)   { heroCanvas.style.display   = 'none'; }
    if (heroFallback) { heroFallback.classList.add('visible'); }

    var configFallbackEl = document.getElementById('config-fallback');
    if (configFallbackEl) { configFallbackEl.classList.add('visible'); }

    hideLoader();
    initScrollAnimations();
    initConfigurator();
    initReveal();
  }
}

init();
