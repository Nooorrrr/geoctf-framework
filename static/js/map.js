// map.js - interactive map + image viewer
let map, marker, viewer;
let pendingNextIndex = null;
let currentIndex = 0;
const challenges = window.GEOCTF_CHALLENGES || [];
const STORAGE_KEY_VIEW = 'geoctf_map_view';
const STORAGE_KEY_MARKER = 'geoctf_marker';
const STORAGE_KEY_CHALLENGE = 'geoctf_current_challenge';

function saveMapView() {
  if (!map) return;
  const c = map.getCenter();
  localStorage.setItem(STORAGE_KEY_VIEW, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }));
}

function saveMarker(lat, lng) {
  localStorage.setItem(STORAGE_KEY_MARKER, JSON.stringify({ lat, lng }));
}

function placeMarker(lat, lng) {
  if (marker) {
    marker.setLatLng([lat, lng]);
  } else {
    marker = L.marker([lat, lng]).addTo(map);
  }
  saveMarker(lat, lng);
  document.getElementById('submit-btn').disabled = false;
}

function updateChallengeInfo() {
  const titleEl = document.getElementById('challenge-title');
  const descEl = document.getElementById('challenge-description');
  const progressEl = document.getElementById('challenge-progress');
  const challenge = challenges[currentIndex] || {};

  titleEl.textContent = challenge.title || titleEl.textContent;
  descEl.textContent = challenge.description || descEl.textContent;
  progressEl.textContent = `Challenge ${currentIndex + 1} of ${challenges.length}`;
}

function resetMarker() {
  if (marker) {
    map.removeLayer(marker);
    marker = null;
  }
  localStorage.removeItem(STORAGE_KEY_MARKER);
  document.getElementById('submit-btn').disabled = true;
}

function destroyViewer() {
  if (viewer && typeof viewer.destroy === 'function') {
    viewer.destroy();
    viewer = null;
  }
}

function loadChallenge(index) {
  if (index < 0 || index >= challenges.length) return;
  currentIndex = index;
  localStorage.setItem(STORAGE_KEY_CHALLENGE, String(currentIndex));

  const container = document.getElementById('viewer-container');
  const panoEl = document.getElementById('pano');
  const imgViewer = document.getElementById('image-viewer');
  const img = document.getElementById('challenge-img');
  const challenge = challenges[currentIndex];

  container.setAttribute('data-index', currentIndex);
  container.setAttribute('data-image-type', challenge.image_type || 'normal');
  container.setAttribute('data-image-src', `/static/${challenge.image}`);

  destroyViewer();

  if (challenge.image_type === '360') {
    imgViewer.style.display = 'none';
    panoEl.style.display = 'block';
    viewer = pannellum.viewer('pano', {
      type: 'equirectangular',
      panorama: `/static/${challenge.image}`,
      autoLoad: true,
      compass: false,
      showZoomCtrl: false,
      showFullscreenCtrl: false,
      mouseZoom: true,
      hfov: 100,
      minHfov: 50,
      maxHfov: 120,
    });
  } else {
    panoEl.style.display = 'none';
    imgViewer.style.display = 'flex';
    img.src = `/static/${challenge.image}`;
  }

  updateChallengeInfo();
  resetMarker();
}

document.addEventListener('DOMContentLoaded', () => {
  // restore last challenge if any
  try {
    const savedIndex = parseInt(localStorage.getItem(STORAGE_KEY_CHALLENGE), 10);
    if (!Number.isNaN(savedIndex) && savedIndex >= 0 && savedIndex < challenges.length) {
      currentIndex = savedIndex;
    }
  } catch (_) {
    currentIndex = 0;
  }

  // try to restore last view from localstorage so reloads keep position
  let initLat = 20, initLng = 0, initZoom = 2;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_VIEW));
    if (saved && saved.lat != null) { initLat = saved.lat; initLng = saved.lng; initZoom = saved.zoom; }
  } catch (_) { /* ignore */ }

  // init leaflet
  map = L.map('map', { zoomControl: false }).setView([initLat, initLng], initZoom);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OSM'
  }).addTo(map);

  // bring back the marker if there was one
  try {
    const savedMarker = JSON.parse(localStorage.getItem(STORAGE_KEY_MARKER));
    if (savedMarker && savedMarker.lat != null) {
      placeMarker(savedMarker.lat, savedMarker.lng);
    }
  } catch (_) { /* ignore */ }

  // save view whenever the user pans or zooms
  map.on('moveend', saveMapView);
  map.on('zoomend', saveMapView);

  map.on('click', function (e) {
    placeMarker(e.latlng.lat, e.latlng.lng);
  });

  // toggle small/large map
  const widget = document.getElementById('map-widget');
  document.getElementById('map-expand-btn').addEventListener('click', () => {
    const isSmall = widget.classList.contains('map-small');
    widget.classList.toggle('map-small', !isSmall);
    widget.classList.toggle('map-large', isSmall);
    setTimeout(() => map.invalidateSize(), 350);
  });

  // submit guess to backend
  document.getElementById('submit-btn').addEventListener('click', async () => {
    if (!marker) return;
    const pos = marker.getLatLng();
    const resultModal = document.getElementById('result-modal');
    const resultContent = document.getElementById('result-content');

    resultContent.innerHTML = '<p style="color:var(--muted)">Checking&hellip;</p>';
    resultModal.style.display = 'flex';

    try {
      const resp = await fetch('/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: pos.lat, lon: pos.lng, index: currentIndex }),
      });

      if (resp.status === 429) {
        resultContent.innerHTML =
          '<div class="result-icon fail">&#9888;</div>' +
          '<div class="result-title fail">Too Many Requests</div>' +
          '<div class="result-msg">You are being rate limited. Try again later.</div>';
        pendingNextIndex = null;
        return;
      }

      const j = await resp.json();
      if (j.success) {
        if (j.final) {
          resultContent.innerHTML =
            '<div class="result-icon success">&#10003;</div>' +
            '<div class="result-title success">All correct!</div>' +
            '<div class="result-flag"></div>';
          resultContent.querySelector('.result-flag').textContent = j.flag;
          pendingNextIndex = null;
        } else {
          resultContent.innerHTML =
            '<div class="result-icon success">&#10003;</div>' +
            '<div class="result-title success">Correct!</div>' +
            '<div class="result-msg"></div>';
          resultContent.querySelector('.result-msg').textContent = 'Great! Next image unlocked.';
          pendingNextIndex = j.next_index;
        }
      } else {
        resultContent.innerHTML =
          '<div class="result-icon fail">&#10007;</div>' +
          '<div class="result-title fail">Wrong</div>' +
          '<div class="result-msg"></div>';
        resultContent.querySelector('.result-msg').textContent = j.message || 'Wrong location. Try again.';
        pendingNextIndex = null;
      }
    } catch (_err) {
      resultContent.innerHTML =
        '<div class="result-icon fail">&#9888;</div>' +
        '<div class="result-title fail">Error</div>' +
        '<div class="result-msg">Error communicating with the server.</div>';
      pendingNextIndex = null;
    }
  });

  document.getElementById('result-close').addEventListener('click', () => {
    document.getElementById('result-modal').style.display = 'none';
    if (pendingNextIndex != null) {
      loadChallenge(pendingNextIndex);
      pendingNextIndex = null;
    }
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    resetMarker();
    document.getElementById('result-modal').style.display = 'none';
  });

  loadChallenge(currentIndex);
});
