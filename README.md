# 🗺️ Campus Outdoor Navigation

An interactive, responsive campus navigation web application designed for **Presidency University, Bengaluru**. It empowers students, faculty, staff, and campus visitors to explore campus facilities, search points of interest, obtain live turn-by-turn pedestrian walking routes, and allows authorized administrators to manage facility markers directly from an integrated map interface.

---

## 📌 Features

### 📍 Interactive Campus Map
- **Custom Tile Layer:** Rendered with [Leaflet.js](https://leafletjs.com/) and OpenStreetMap tiles.
- **Categorized Facility Markers:** Colorful, customized badge markers for Academic Blocks, Dining, Administration, Libraries, Sports, Cafes, and Seminar Halls.
- **Detailed Popup Cards:** Click any marker to view facility information, category tags, descriptions, and initiate walking directions.

### 🔍 Instant Search & Discovery
- Real-time search filter matching facility names (including bilingual names like Kannada script), descriptions, and categories.
- One-click map fly-to and popup auto-open for selected search results.

### 🚶 Real Pedestrian Walking Routing
- **OpenStreetMap OSRM Integration:** Utilizes the pedestrian profile (`routed-foot`) to calculate authentic walking paths across campus walkways rather than simple straight-line estimates.
- **Live Walking Estimates:** Displays exact walking distance (in meters or kilometers) and estimated walking time in minutes.
- **Current Location Support:** Detects user location via the browser Geolocation API and calculates routes from the user's live position directly to any campus building.

### 🛡️ Built-in Admin Management System
- **Secure Authentication:** Server-side password verification with encrypted session cookies.
- **Interactive Click-to-Place:** Administrators can add new facilities by clicking directly on the map to set exact GPS coordinates.
- **Full CRUD Management:** Add, edit metadata/coordinates, or remove facilities on the fly with automatic persistence to the JSON datastore.

### 🔒 Production-Hardened Security
- Refuses to start in production without explicit configuration of `FLASK_SECRET_KEY` and `CAMPUS_ADMIN_PASSWORD`.
- Production detection for Render and cloud environments (`FLASK_ENV=production` or `RENDER=true`).
- Sensitive `.bak` files, virtual environments, and caches excluded via `.gitignore`.

---

## 🛠️ Technology Stack

| Component | Technology | Description |
|-----------|------------|-------------|
| **Backend** | Python 3, Flask | Lightweight REST API server and template rendering |
| **Production WSGI** | Gunicorn | Production HTTP server |
| **Frontend Map** | Leaflet.js | Open-source mobile-friendly interactive maps |
| **Routing Service** | OSRM (`routed-foot`) | OpenStreetMap Community Pedestrian Routing API |
| **Frontend UI** | HTML5, CSS3, Vanilla JS | Clean, responsive design without bulky framework dependencies |
| **Data Store** | JSON (`campus_facilities.json`) | Lightweight, portable facility database |

---

## 📂 Project Structure

```text
campus_navigation/
├── app.py                      # Flask backend & REST API endpoints
├── requirements.txt            # Python dependencies (Flask, Gunicorn)
├── Procfile                    # Deployment command for Render / Heroku
├── .gitignore                  # Git ignore rules for Python & venv
├── .gitattributes              # Line endings and repo settings
├── README.md                   # Project documentation
├── data/
│   └── campus_facilities.json  # Facility database (names, coordinates, tags)
├── static/
│   ├── css/
│   │   └── style.css           # Styling, themes, responsive layout, animations
│   └── js/
│       └── main.js             # Leaflet initialization, routing, admin modal logic
└── templates/
    └── index.html              # Main application web page
```

---

## 🚀 Getting Started (Local Development)

### 1. Prerequisites
- Python 3.10+ installed on your system
- Git installed

### 2. Clone the Repository
```bash
git clone https://github.com/Saikat-Shil/Campus-navigation.git
cd Campus-navigation
```

### 3. Create and Activate a Virtual Environment
- **Windows (Command Prompt / PowerShell):**
  ```powershell
  python -m venv .venv
  .venv\Scripts\activate
  ```
- **macOS / Linux:**
  ```bash
  python3 -m venv .venv
  source .venv/bin/activate
  ```

### 4. Install Dependencies
```bash
pip install -r requirements.txt
```

### 5. Run the Application
```bash
python app.py
```
Open your browser and navigate to:
```
http://localhost:5000
```

---

## 🔑 Environment Variables

For local development, default values allow the app to run out-of-the-box. For production environments, configure these environment variables:

| Variable | Required in Production | Description | Default (Dev) |
|----------|:---------------------:|-------------|---------------|
| `FLASK_SECRET_KEY` | **Yes** | Secret key for signing secure HTTP-only session cookies | Random `os.urandom(32)` |
| `CAMPUS_ADMIN_PASSWORD_HASH` | Optional (Recommended) | Pre-computed PBKDF2/scrypt salted hash of admin credentials | — |
| `CAMPUS_ADMIN_PASSWORD` | Optional* | Plaintext admin password (immediately hashed in memory and wiped from environment) | `presidency@admin2026` |
| `PORT` | No | Server port | `5000` |
| `FLASK_ENV` | No | Set to `production` for production mode | `development` |
| `RENDER` | Auto | Automatically set to `true` on Render | — |

*\* Either `CAMPUS_ADMIN_PASSWORD_HASH` or `CAMPUS_ADMIN_PASSWORD` is required in production.*

---

## 🔒 Security Architecture

1. **Zero Plaintext Transmission:** The client browser computes a SHA-256 digest of the admin password using the native browser **Web Crypto API** before sending it to `/api/admin/login`. Plaintext passwords never appear in network inspector logs or transit.
2. **Salted Server-side Hashes:** Passwords are never stored in plaintext in the backend or in memory. The backend stores only salted PBKDF2/scrypt hashes.
3. **Timing & Brute-Force Protection:** Verification uses constant-time comparison (`hmac.compare_digest`), coupled with artificial response throttling on failed authentication attempts.
4. **Hardened Session Cookies:** Session cookies are configured with `HttpOnly`, `SameSite=Lax`, and `Secure` (HTTPS-only in production), preventing cross-site scripting (XSS) and cross-site request forgery (CSRF) token theft.

---

## 📡 REST API Reference

### Public Endpoints
- `GET /` — Serves the main navigation web application.
- `GET /api/facilities` — Returns a JSON array of all campus facilities and metadata.
- `GET /api/route?start_lat={lat}&start_lon={lon}&dest_lat={lat}&dest_lon={lon}` — Returns pedestrian walking route geometry, distance, and duration via OSRM.

### Administrator Endpoints (Session Required)
- `GET /api/admin/status` — Checks if the current session has admin privileges.
- `POST /api/admin/login` — Authenticates admin with `{"credential": "<sha256_hash>"}`.
- `POST /api/admin/logout` — Terminates the admin session.
- `POST /api/facilities` — Adds a new facility entry.
- `PUT /api/facilities/<facility_id>` — Updates facility metadata or coordinates.
- `DELETE /api/facilities/<facility_id>` — Removes a facility from the dataset.

---


## 📄 License

This project is licensed under the MIT License - feel free to use and adapt it for your campus or organization.
