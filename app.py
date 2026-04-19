import os
import json
import time
import random
import logging
import subprocess
from logging.handlers import RotatingFileHandler
from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_compress import Compress
from flask_limiter import Limiter
from geopy.distance import geodesic

# Create Flask app
app = Flask(__name__, static_folder='static', template_folder='templates')

# gzip compression for all responses
Compress(app)

# tell browsers to cache static files for 30 minutes
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 1800

# Maximun content length
app.config['MAX_CONTENT_LENGTH'] = 1024

# Load configuration from config.json at startup
CONFIG_PATH = os.environ.get('GEOCTF_CONFIG', 'config.json')

try:
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        CONFIG = json.load(f)
except Exception:
    CONFIG = None

# if behind a reverse proxy, use X-Forwarded-For to get the real client IP
# otherwise use the direct remote address (don't trust the header if exposed)
BEHIND_PROXY = CONFIG.get('behind_proxy', False) if CONFIG else False

if BEHIND_PROXY:
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1)

def _get_real_ip():
    if BEHIND_PROXY:
        return request.access_route[0]
    return request.remote_addr

limiter = Limiter(key_func=_get_real_ip, app=app, default_limits=[], storage_uri="memory://")

# Configure logging based on config.json "logger" flag
logger = logging.getLogger('geoctf')
LOGGING_ENABLED = CONFIG.get('logger', False) if CONFIG else False

if LOGGING_ENABLED:
    logger.setLevel(logging.INFO)
    handler = RotatingFileHandler('geoctf.log', maxBytes=1000000, backupCount=3)
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
else:
    logger.setLevel(logging.CRITICAL)
    logger.addHandler(logging.NullHandler())


def _normalize_challenge(challenge, global_title='', global_description=''):
    normalized = {
        'image': challenge.get('image', ''),
        'image_type': challenge.get('image_type', 'normal'),
        'title': challenge.get('title', global_title),
        'description': challenge.get('description', global_description),
        'threshold_meters': float(challenge.get('threshold_meters', 100)),
        'lat': float(challenge.get('lat', 0)),
        'lon': float(challenge.get('lon', 0)),
    }
    return normalized


def _build_challenges(config):
    if not config:
        return [], []

    global_title = config.get('title', '')
    global_description = config.get('description', '')
    raw_challenges = []
    if isinstance(config.get('challenges'), list) and config['challenges']:
        raw_challenges = config['challenges']
    elif config.get('image'):
        raw_challenges = [config]

    internal = []
    public = []
    for raw in raw_challenges:
        try:
            normalized = _normalize_challenge(raw, global_title, global_description)
        except (TypeError, ValueError):
            continue
        if not normalized['image'] or normalized['lat'] is None or normalized['lon'] is None:
            continue
        internal.append(normalized)
        public.append({
            'image': normalized['image'],
            'image_type': normalized['image_type'],
            'title': normalized['title'],
            'description': normalized['description'],
        })

    return internal, public


CHALLENGES, PUBLIC_CHALLENGES = _build_challenges(CONFIG)

# strip EXIF metadata from the challenge images on startup
# prevents leaking GPS coords or Google Image IDs from Street View downloads
if CONFIG:
    for challenge in CHALLENGES:
        _img_path = os.path.join('static', challenge['image'])
        if os.path.isfile(_img_path):
            try:
                subprocess.run(['exiftool', '-all=', '-overwrite_original', _img_path],
                               check=True, capture_output=True)
                logger.info('Stripped EXIF metadata from %s', _img_path)
            except FileNotFoundError:
                logger.warning('exiftool not installed, skipping metadata strip for %s', _img_path)
            except subprocess.CalledProcessError as e:
                logger.warning('Failed to strip metadata from %s: %s', _img_path, e)


def validate_coords(lat, lon):
    try:
        lat = float(lat)
        lon = float(lon)
    except (TypeError, ValueError):
        return False
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return False
    return True


# min response time in seconds to prevent timing attacks
# adds random jitter so all responses take roughly the same time
CHECK_MIN_TIME = 0.15
CHECK_JITTER   = 0.1

def constant_time_wait(start):
    """sleep until at least CHECK_MIN_TIME + random jitter has passed"""
    elapsed = time.time() - start
    target = CHECK_MIN_TIME + random.uniform(0, CHECK_JITTER)
    if elapsed < target:
        time.sleep(target - elapsed)


# Default static main challenge page
@app.route('/')
def index():
    if not CONFIG or not CHALLENGES:
        return "Server misconfigured.", 500

    first = PUBLIC_CHALLENGES[0]
    return render_template(
        'index.html',
        title=CONFIG.get('title', ''),
        description=CONFIG.get('description', ''),
        challenges=PUBLIC_CHALLENGES,
        first_image=first.get('image', ''),
        first_image_type=first.get('image_type', 'normal'),
    )

# Check cords endpoint — 10 requests per minute per IP
@app.route('/check', methods=['POST'])
@limiter.limit("10/minute")
def check():
    start = time.time()

    if not CONFIG or not CHALLENGES:
        constant_time_wait(start)
        return jsonify(success=False, message='Server misconfigured.'), 500

    data = request.get_json(silent=True)
    if not data:
        constant_time_wait(start)
        return jsonify(success=False, message='Invalid request.'), 400

    lat = data.get('lat')
    lon = data.get('lon')
    idx = data.get('index')

    try:
        idx = int(idx)
    except (TypeError, ValueError):
        constant_time_wait(start)
        return jsonify(success=False, message='Invalid request.'), 400

    if idx < 0 or idx >= len(CHALLENGES):
        constant_time_wait(start)
        return jsonify(success=False, message='Invalid request.'), 400

    if not validate_coords(lat, lon):
        logger.info('Invalid coords attempt: %s', data)
        constant_time_wait(start)
        return jsonify(success=False, message='Wrong location. Try again.'), 400

    # always compute distance
    try:
        user_loc = (float(lat), float(lon))
        target_challenge = CHALLENGES[idx]
        target_loc = (target_challenge['lat'], target_challenge['lon'])
        distance_m = geodesic(user_loc, target_loc).meters
        success = distance_m <= target_challenge['threshold_meters']
    except Exception:
        logger.exception('Error calculating distance for %s', data)
        constant_time_wait(start)
        return jsonify(success=False, message='Wrong location. Try again.'), 400

    logger.info('Attempt idx=%s lat=%s lon=%s result=%s', idx, lat, lon, 'success' if success else 'fail')

    if success:
        if idx + 1 < len(CHALLENGES):
            resp = jsonify(success=True, next_index=idx + 1)
        else:
            resp = jsonify(success=True, final=True, flag=CONFIG.get('flag', ''))
    else:
        resp = jsonify(success=False, message='Wrong location. Try again.'), 400

    constant_time_wait(start)
    return resp

# Static path
@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(app.static_folder, filename)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
