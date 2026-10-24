from flask import Flask, render_template, jsonify, request, session
from functools import wraps
import json
import os
import sys
import urllib.request
import urllib.error

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Production-safety: detect whether we are running on Render (or any
# environment that explicitly sets FLASK_ENV=production).  When running in
# production the app will refuse to start with hard-coded fallback secrets.
# Locally, fallback values keep development working without any extra setup.
# ---------------------------------------------------------------------------
_IS_PRODUCTION = (
    os.environ.get("RENDER") == "true"
    or os.environ.get("FLASK_ENV", "").lower() == "production"
)

# Secret key for secure session cookies.
# REQUIRED in production: set the FLASK_SECRET_KEY environment variable on Render.
_secret_key_env = os.environ.get("FLASK_SECRET_KEY")
if _IS_PRODUCTION and not _secret_key_env:
    sys.exit(
        "STARTUP ERROR: FLASK_SECRET_KEY environment variable is not set. "
        "Set it in the Render dashboard under Environment > Secret Files or "
        "Environment Variables before deploying."
    )
app.secret_key = _secret_key_env or os.urandom(32)

# Admin password — configurable via environment variable.
# REQUIRED in production: set the CAMPUS_ADMIN_PASSWORD environment variable on Render.
_admin_password_env = os.environ.get("CAMPUS_ADMIN_PASSWORD")
if _IS_PRODUCTION and not _admin_password_env:
    sys.exit(
        "STARTUP ERROR: CAMPUS_ADMIN_PASSWORD environment variable is not set. "
        "Set it in the Render dashboard under Environment > Secret Files or "
        "Environment Variables before deploying."
    )
ADMIN_PASSWORD = _admin_password_env
FACILITIES_FILE = os.path.join(os.path.dirname(__file__), "data", "campus_facilities.json")


def load_facilities_data():
    with open(FACILITIES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_facilities_data(data):
    with open(FACILITIES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("is_admin"):
            return jsonify({"error": "Unauthorized: Administrator privileges required."}), 401
        return f(*args, **kwargs)
    return decorated


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/admin/status", methods=["GET"])
def admin_status():
    """Check if current session has admin privileges"""
    return jsonify({"is_admin": bool(session.get("is_admin", False))})


@app.route("/api/admin/login", methods=["POST"])
def admin_login():
    """Authenticate administrator using server-side password verification"""
    payload = request.get_json(silent=True) or {}
    password = payload.get("password", "")

    if password and password == ADMIN_PASSWORD:
        session["is_admin"] = True
        return jsonify({"success": True, "message": "Administrator authenticated successfully."})
    
    return jsonify({"error": "Invalid administrator password."}), 401


@app.route("/api/admin/logout", methods=["POST"])
def admin_logout():
    """Clear administrator session"""
    session.pop("is_admin", None)
    return jsonify({"success": True, "message": "Logged out successfully."})


@app.route("/api/facilities", methods=["GET"])
def get_facilities():
    """Retrieve all campus facilities (Public read access)"""
    try:
        facilities = load_facilities_data()
        return jsonify(facilities)
    except Exception as e:
        return jsonify({"error": f"Failed to load facilities: {str(e)}"}), 500


@app.route("/api/route", methods=["GET"])
def get_walking_route():
    """
    Calculate a genuine pedestrian walking route using the OpenStreetMap
    community OSRM pedestrian routing engine (routed-foot profile).
    Free, open, and requires no API key.
    """
    start_lat = request.args.get("start_lat", type=float)
    start_lon = request.args.get("start_lon", type=float)
    dest_lat = request.args.get("dest_lat", type=float)
    dest_lon = request.args.get("dest_lon", type=float)

    if None in (start_lat, start_lon, dest_lat, dest_lon):
        return jsonify({
            "error": "Missing coordinates: start_lat, start_lon, dest_lat, and dest_lon are required."
        }), 400

    # Official OSM Foundation pedestrian routing service URL (lon,lat format)
    osrm_url = (
        f"https://routing.openstreetmap.de/routed-foot/route/v1/foot/"
        f"{start_lon},{start_lat};{dest_lon},{dest_lat}?overview=full&geometries=geojson"
    )

    try:
        req = urllib.request.Request(
            osrm_url,
            headers={"User-Agent": "PresidencyCampusNav/1.0 (Walking Route)"}
        )
        with urllib.request.urlopen(req, timeout=12) as response:
            data = json.loads(response.read().decode("utf-8"))

        if data.get("code") != "Ok" or not data.get("routes"):
            return jsonify({
                "error": "No pedestrian walking route found between these locations."
            }), 404

        route = data["routes"][0]
        # Convert GeoJSON [lon, lat] pairs to Leaflet [lat, lon] pairs
        leaflet_coords = [[coord[1], coord[0]] for coord in route["geometry"]["coordinates"]]
        distance_meters = round(route["distance"])
        duration_seconds = round(route["duration"])

        # Format human-readable distance
        if distance_meters >= 1000:
            formatted_distance = f"{distance_meters / 1000:.1f} km"
        else:
            formatted_distance = f"{distance_meters} m"

        # Format human-readable duration (average pedestrian walking speed ~4.5 km/h)
        walking_mins = max(1, round(duration_seconds / 60))
        formatted_duration = f"{walking_mins} min" if walking_mins == 1 else f"{walking_mins} mins"

        return jsonify({
            "success": True,
            "coordinates": leaflet_coords,
            "distance_meters": distance_meters,
            "duration_seconds": duration_seconds,
            "formatted_distance": formatted_distance,
            "formatted_duration": formatted_duration,
            "service": "OSRM Pedestrian (routed-foot)"
        })
    except urllib.error.URLError:
        return jsonify({
            "error": "Pedestrian routing service is temporarily unreachable. Please check your internet connection."
        }), 503
    except Exception as e:
        return jsonify({
            "error": f"Failed to compute walking route: {str(e)}"
        }), 500


@app.route("/api/facilities", methods=["POST"])
@admin_required
def create_facility():
    """Add a new facility (Admin only)"""
    try:
        new_item = request.get_json()
        if not new_item or "id" not in new_item or "name" not in new_item:
            return jsonify({"error": "Invalid facility data: 'id' and 'name' are required."}), 400

        facilities = load_facilities_data()
        if any(f["id"] == new_item["id"] for f in facilities):
            return jsonify({"error": f"Facility with ID '{new_item['id']}' already exists."}), 400

        facilities.append(new_item)
        save_facilities_data(facilities)
        return jsonify({"success": True, "facility": new_item}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/facilities/<facility_id>", methods=["PUT"])
@admin_required
def update_facility(facility_id):
    """Update an existing facility's coordinates or metadata (Admin only)"""
    try:
        updates = request.get_json()
        if not updates:
            return jsonify({"error": "No update payload provided."}), 400

        facilities = load_facilities_data()
        found = False
        updated_facility = None

        for idx, f in enumerate(facilities):
            if f["id"] == facility_id:
                facilities[idx].update(updates)
                found = True
                updated_facility = facilities[idx]
                break

        if not found:
            return jsonify({"error": f"Facility '{facility_id}' not found."}), 404

        save_facilities_data(facilities)
        return jsonify({"success": True, "facility": updated_facility})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/facilities/<facility_id>", methods=["DELETE"])
@admin_required
def delete_facility(facility_id):
    """Delete a facility (Admin only)"""
    try:
        facilities = load_facilities_data()
        filtered = [f for f in facilities if f["id"] != facility_id]

        if len(filtered) == len(facilities):
            return jsonify({"error": f"Facility '{facility_id}' not found."}), 404

        save_facilities_data(filtered)
        return jsonify({"success": True, "message": f"Facility '{facility_id}' deleted."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # Gunicorn handles host/port/debug in production (via Procfile).
    # This block is only used when running locally with `python app.py`.
    _port = int(os.environ.get("PORT", 5000))
    _debug = not _IS_PRODUCTION  # debug=True locally, False in production
    app.run(host="0.0.0.0", port=_port, debug=_debug)
