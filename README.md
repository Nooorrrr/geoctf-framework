# GeoCTF Framework

Free and open-source framework for GEOSINT challenges in CTFs. Drop an image, set the coordinates and a flag in the config file, build the Docker container and you have a ready-to-go GeoGuessr-style challenge for your competition.

## Features

- **GeoGuessr-style UI** — Fullscreen image/panorama viewer with a collapsible map widget in the bottom-right corner.
- **360° panorama support** — Powered by [Pannellum](https://pannellum.org/). Set `image_type` to `"360"` in `config.json` to enable equirectangular panorama viewing.
- **Normal image support** — Standard images are displayed fullscreen with `object-fit: contain`.
- **Single challenge** configurable via `config.json`.
- **Stateless** — No sessions, multiple users can play simultaneously.
- **Server-side validation** — Coordinates and distance are computed on the backend (Flask + geopy). The correct location is never exposed to the client.
- **Expandable map** — The map widget can be toggled between small (340×280) and large (640×480) with a button.
- **Result modal** — Success/failure is shown in a centered modal overlay with blur backdrop.
- **Persistent map state** — Map position, zoom level and marker are saved to localStorage so nothing is lost on accidental page reloads.
- **Static asset caching** — Images, CSS and JS are served with `Cache-Control` headers (30m) and gzip compression via flask-compress to reduce bandwidth.
- **Rate limiting** — The `/check` endpoint is limited to 10 requests per minute per IP to prevent brute-force coordinate sweeping.
- **Timing attack protection** — All responses from `/check` are padded to a constant time window with random jitter, so an attacker cannot infer proximity by measuring response times.
- **Docker ready** — Ships with Dockerfile and docker-compose.

## Quick Start

1. Edit `config.json` with your challenge (coordinates, flag, threshold, and image filename).
2. Place your challenge image in `static/` (e.g., `static/challenge.jpg`).
3. The app uses OpenStreetMap via Leaflet.js — no API key required.
4. Start the service:

```bash
docker-compose build && docker-compose up -d
```

Open http://localhost:5000

## Project Structure

```
geoctf-framework/
├── app.py                 # Flask backend (route handling, distance check)
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── config.json            # Challenge configuration
├── static/
│   ├── challenge.jpg      # Challenge image (normal or equirectangular 360°)
│   ├── css/style.css      # GeoGuessr-style dark theme
│   └── js/map.js          # Leaflet map + Pannellum 360 viewer logic
└── templates/index.html   # Single-page app template
```

## `config.json` Reference

| Field | Type | Description |
|---|---|---|
| `title` | string | Challenge title shown in the top-left overlay |
| `description` | string | Short description below the title |
| `image` | string | Filename of the image inside `static/` |
| `image_type` | string | `"normal"` for a standard image, `"360"` for an equirectangular panorama |
| `lat` | number | Target latitude (server-side only) |
| `lon` | number | Target longitude (server-side only) |
| `threshold_meters` | number | Maximum distance in meters to accept the guess |
| `flag` | string | Flag returned on a correct guess |
| `logger` | boolean | `true` to enable logging to `geoctf.log`, `false` to disable it |
| `behind_proxy` | boolean | `true` if running behind a reverse proxy (Cloudflare, Traefik, Nginx, etc.) so the rate limiter reads the real client IP from `X-Forwarded-For`. Keep `false` when exposed directly to avoid header spoofing |

Example:

```json
{
  "title": "Where was this photo taken?",
  "description": "Find the exact location of this image",
  "image": "challenge.jpg",
  "image_type": "360",
  "lat": 40.4168,
  "lon": -3.7038,
  "threshold_meters": 100,
  "flag": "GEOCTF{madrid_puerta_del_sol}",
  "logger": true,
  "behind_proxy": false
}
```

## Security & Design Notes

- The server never exposes the correct location or threshold to the client.
- Basic lat/lon validation on the server side.
- `/check` is rate-limited to **10 req/min per IP** via flask-limiter. Exceeding the limit returns `429 Too Many Requests`.
- **Proxy support** — Set `behind_proxy` to `true` in `config.json` if the service runs behind a reverse proxy. This enables `ProxyFix` and reads the real client IP from `X-Forwarded-For`. Never enable this when the service is directly exposed — anyone could spoof the header and bypass the rate limit.
- **Constant-time responses** — Every `/check` response (success, fail, invalid, error) is delayed to a fixed window of 150–250ms with random jitter. This prevents timing side-channels where an attacker could measure response times to binary-search the target coordinates or deduce the threshold radius.
- Attempt logs are stored in `geoctf.log` when `logger` is enabled in `config.json`.
- Stateless: each `/check` request is independent.

## Frontend Stack

- **[Leaflet](https://leafletjs.com/)** — Interactive map with OpenStreetMap tiles.
- **[Pannellum](https://pannellum.org/)** — Lightweight 360° panorama viewer.
- Vanilla JavaScript, no build step required.

## Getting 360° Images

To download equirectangular panoramas from Google Street View you can use [Street View Download 360](https://svd360.com/#downloads). It lets you grab full 360° images from any Street View location and export them as equirectangular JPGs ready to use with this framework.

> **EXIF metadata is stripped automatically.** The framework runs `exiftool -all=` on the challenge image at startup to remove all metadata. This is critical because images from Street View Download 360 contain GPS coordinates and a Google `Image ID` (e.g. `Pokmh0VM7lqIFPo03Krreg`) that can be searched on Google Maps to find the exact location. The Docker image ships with `exiftool` pre-installed. If running locally without it, install it with `sudo apt install libimage-exiftool-perl`.

## Local Development (without Docker)

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

## Credits

Made by [Guchi](https://guchihacker.github.io/)