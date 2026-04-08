// map.js - interactive map + image viewer
let map, marker;

const STORAGE_KEY_VIEW   = 'geoctf_map_view';
const STORAGE_KEY_MARKER = 'geoctf_marker';

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

document.addEventListener('DOMContentLoaded', () => {
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

  // send guess to backend
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
        body: JSON.stringify({ lat: pos.lat, lon: pos.lng }),
      });
      const j = await resp.json();
      if (j.success) {
        resultContent.innerHTML =
          '<div class="result-icon success">&#10003;</div>' +
          '<div class="result-title success">Correct!</div>' +
          '<div class="result-flag"></div>';
        resultContent.querySelector('.result-flag').textContent = j.flag;
      } else {
        resultContent.innerHTML =
          '<div class="result-icon fail">&#10007;</div>' +
          '<div class="result-title fail">Wrong</div>' +
          '<div class="result-msg"></div>';
        resultContent.querySelector('.result-msg').textContent =
          j.message || 'Wrong location. Try again.';
      }
    } catch (_err) {
      resultContent.innerHTML =
        '<div class="result-icon fail">&#9888;</div>' +
        '<div class="result-title fail">Error</div>' +
        '<div class="result-msg">Error communicating with the server.</div>';
    }
  });

  // dismiss modal
  document.getElementById('result-close').addEventListener('click', () => {
    document.getElementById('result-modal').style.display = 'none';
  });

  // clear marker and start over
  document.getElementById('reset-btn').addEventListener('click', () => {
    if (marker) { map.removeLayer(marker); marker = null; }
    localStorage.removeItem(STORAGE_KEY_MARKER);
    document.getElementById('submit-btn').disabled = true;
    document.getElementById('result-modal').style.display = 'none';
  });

  // set up the image viewer or pannellum for 360 panos
  const container = document.getElementById('viewer-container');
  const imageType = (container.getAttribute('data-image-type') || 'normal').trim();
  const imageSrc = container.getAttribute('data-image-src');
  const panoEl = document.getElementById('pano');
  const imgViewer = document.getElementById('image-viewer');

  if (imageType === '360') {
    imgViewer.style.display = 'none';
    panoEl.style.display = 'block';

    pannellum.viewer('pano', {
      type: 'equirectangular',
      panorama: imageSrc,
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
  }
});
