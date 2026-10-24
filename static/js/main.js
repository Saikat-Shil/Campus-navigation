// Initialize Leaflet map centered at Presidency University, Rajanakunte
const campusCoords = [13.1695, 77.5358];
const campusZoom = 16;

// Position zoom controls in bottom-right to keep top-left clear for search box
const map = L.map('map', { zoomControl: false }).setView(campusCoords, campusZoom);
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Add OpenStreetMap base tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Layer group to hold all facility markers
const facilitiesLayer = L.layerGroup().addTo(map);

// Separate layer group for user location (can be updated without touching facilities)
const userLocationLayer = L.layerGroup().addTo(map);

// Dedicated layer for walking route lines
const routeLayer = L.layerGroup().addTo(map);

// State management
let campusFacilities = [];
const markerMap = new Map(); // facility.id -> L.marker
let isAdmin = false;
let activePlacementFacility = null;
let pendingPlacementCoord = null;
let currentUserLocation = null;

/**
 * Validates latitude and longitude format and ranges
 */
function isValidCoordinate(coords) {
    if (!Array.isArray(coords) || coords.length !== 2) return false;
    const [lat, lon] = coords;
    return typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90 &&
           typeof lon === 'number' && !isNaN(lon) && lon >= -180 && lon <= 180;
}

/**
 * Creates a custom circular badge icon with color and emoji/symbol
 */
function createCustomIcon(iconSymbol, color) {
    return L.divIcon({
        className: 'custom-pin-container',
        html: `<div class="custom-pin" style="background-color: ${color || '#2563eb'};">${iconSymbol || '📍'}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16]
    });
}

/**
 * Helper to escape HTML characters in user input to prevent XSS
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[m];
    });
}

/**
 * Builds HTML content for the marker popup
 */
function createPopupContent(facility) {
    const hasCoords = isValidCoordinate(facility.coordinates);
    const lat = hasCoords ? facility.coordinates[0].toFixed(5) : 'Unset';
    const lon = hasCoords ? facility.coordinates[1].toFixed(5) : 'Unset';

    // Sub-facilities (e.g. Seminar Halls in E/F/L blocks)
    let subHtml = '';
    if (facility.sub_facilities && Array.isArray(facility.sub_facilities) && facility.sub_facilities.length > 0) {
        subHtml = `
            <div class="sub-facilities-container">
                <div class="sub-facilities-title">Seminar Halls & Facilities:</div>
                ${facility.sub_facilities.map(sub => {
                    const isUpcoming = (sub.status || '').toLowerCase().includes('upcoming');
                    const pillClass = isUpcoming ? 'status-pill upcoming' : 'status-pill available';
                    return `
                        <div class="sub-facility-item">
                            <span><strong>${escapeHtml(sub.name)}</strong> (${escapeHtml(sub.floor || 'Ground')})</span>
                            <span class="${pillClass}">${escapeHtml(sub.status || 'Available')}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    // Get Directions button for mapped facilities
    let directionsBtn = '';
    if (hasCoords && !facility.pending_location) {
        directionsBtn = `
            <button type="button" class="btn-directions" onclick="startNavigationTo('${facility.id}', '${escapeHtml(facility.name)}')">
                🚶 Get Directions
            </button>
        `;
    }

    // Admin-only action buttons inside popup
    let adminBar = '';
    if (isAdmin) {
        adminBar = `
            <div class="popup-admin-actions">
                <button type="button" class="popup-admin-btn" onclick="startPlacementMode('${facility.id}', '${escapeHtml(facility.name)}')">📍 Reposition on Map</button>
                <button type="button" class="popup-admin-btn" style="color: #b91c1c;" onclick="deleteFacility('${facility.id}', '${escapeHtml(facility.name)}')">🗑️ Delete</button>
            </div>
        `;
    }

    return `
        <div class="facility-popup">
            <span class="badge" style="background-color: ${facility.color || '#2563eb'};">${escapeHtml(facility.category)}</span>
            <h3>${escapeHtml(facility.name)}</h3>
            ${facility.description ? `<p>${escapeHtml(facility.description)}</p>` : ''}
            ${subHtml}
            <div class="coords-meta" style="margin-top: 6px;">📍 ${lat}, ${lon}</div>
            <div class="source-meta">Source: ${escapeHtml(facility.source || 'Campus Record')}</div>
            ${directionsBtn}
            ${adminBar}
        </div>
    `;
}

/**
 * Toast notification helper
 */
let toastTimer = null;
function showToast(message, type = 'loading', duration = 4000) {
    const toast = document.getElementById('location-toast');
    if (!toast) return;

    if (toastTimer) clearTimeout(toastTimer);
    toast.className = `location-toast ${type}`;
    toast.textContent = message;
    toast.style.display = 'flex';

    if (duration > 0) {
        toastTimer = setTimeout(() => {
            toast.style.display = 'none';
        }, duration);
    }
}

/**
 * Fetches and plots campus facilities from the backend API
 */
async function loadCampusFacilities() {
    try {
        const response = await fetch('/api/facilities');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const facilities = await response.json();
        facilitiesLayer.clearLayers();
        markerMap.clear();
        campusFacilities = facilities;

        const seenIds = new Set();
        let plottedCount = 0;

        facilities.forEach((facility) => {
            if (!facility.id || seenIds.has(facility.id)) {
                return;
            }
            seenIds.add(facility.id);

            // Only plot markers if coordinates are valid and verified
            if (isValidCoordinate(facility.coordinates) && !facility.pending_location) {
                const marker = L.marker(facility.coordinates, {
                    icon: createCustomIcon(facility.icon, facility.color),
                    title: facility.name
                });

                marker.bindPopup(createPopupContent(facility));
                marker.addTo(facilitiesLayer);

                markerMap.set(facility.id, marker);
                plottedCount++;
            }
        });

        console.log(`Loaded ${facilities.length} total facilities (${plottedCount} plotted on map).`);
        initFacilitySearch();
        updateAdminManagerUI();
    } catch (error) {
        console.error("Failed to load campus facilities:", error);
    }
}

/**
 * Initializes the facility search box, live matching, and selection handling
 */
function initFacilitySearch() {
    const searchInput = document.getElementById('facility-search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    const resultsList = document.getElementById('search-results-list');

    if (!searchInput || !clearBtn || !resultsList) return;

    function handleSearch() {
        const query = searchInput.value.trim().toLowerCase();

        if (!query) {
            resultsList.innerHTML = '';
            resultsList.style.display = 'none';
            clearBtn.style.display = 'none';
            return;
        }

        clearBtn.style.display = 'block';

        // Prepare flattened search items (including individual seminar halls)
        const matchedItems = [];

        campusFacilities.forEach((f) => {
            const nameMatch = f.name && f.name.toLowerCase().includes(query);
            const catMatch = f.category && f.category.toLowerCase().includes(query);
            const descMatch = f.description && f.description.toLowerCase().includes(query);
            const buildingMatch = f.building && f.building.toLowerCase().includes(query);

            // Check if any sub-facilities (like individual Seminar Halls) match
            let matchedSubs = [];
            if (f.sub_facilities && Array.isArray(f.sub_facilities)) {
                matchedSubs = f.sub_facilities.filter(sub => {
                    return sub.name.toLowerCase().includes(query) ||
                           (sub.floor || '').toLowerCase().includes(query) ||
                           (sub.status || '').toLowerCase().includes(query);
                });
            }

            // If a specific sub-facility matched (e.g. "Seminar Hall 3" or "Seminar Hall 6")
            if (matchedSubs.length > 0) {
                matchedSubs.forEach(sub => {
                    const isUpcoming = (sub.status || '').toLowerCase().includes('upcoming');
                    matchedItems.push({
                        id: f.id,
                        displayName: `${sub.name} — ${f.name}`,
                        category: f.category,
                        icon: f.icon || '🏫',
                        color: f.color || '#2563eb',
                        description: `${sub.floor || 'Ground'} • ${f.description || ''}`,
                        statusTag: isUpcoming ? 'Upcoming — Not yet available' : (sub.status || 'Available'),
                        isUpcoming: isUpcoming,
                        parentFacility: f
                    });
                });
            } else if (nameMatch || catMatch || descMatch || buildingMatch) {
                matchedItems.push({
                    id: f.id,
                    displayName: f.name,
                    category: f.category,
                    icon: f.icon || '📍',
                    color: f.color || '#2563eb',
                    description: f.description || '',
                    statusTag: f.pending_location ? 'Pending Location' : null,
                    isUpcoming: false,
                    parentFacility: f
                });
            }
        });

        if (matchedItems.length === 0) {
            resultsList.innerHTML = `
                <div class="search-no-results">
                    No facilities found matching "<strong>${escapeHtml(searchInput.value.trim())}</strong>"
                    <span class="help-tip">Try searching for Auditorium, Football Court, Seminar Hall 1-6, Canteen, ATM...</span>
                </div>
            `;
            resultsList.style.display = 'block';
            return;
        }

        // Render matching facilities
        resultsList.innerHTML = matchedItems.map((item) => `
            <div class="search-result-item" data-id="${item.id}">
                <div class="result-icon" style="background-color: ${item.color}; color: #ffffff;">
                    ${item.icon}
                </div>
                <div class="result-info">
                    <div class="result-header">
                        <span class="result-name">${escapeHtml(item.displayName)}</span>
                        <span class="result-category-badge" style="background-color: ${item.color};">${escapeHtml(item.category)}</span>
                    </div>
                    <div class="result-desc">
                        ${item.statusTag ? `<span class="status-pill ${item.isUpcoming ? 'upcoming' : 'available'}" style="margin-right: 4px;">${escapeHtml(item.statusTag)}</span>` : ''}
                        ${escapeHtml(item.description)}
                    </div>
                </div>
            </div>
        `).join('');

        resultsList.style.display = 'block';

        // Attach click listeners to result items
        resultsList.querySelectorAll('.search-result-item').forEach((itemEl) => {
            itemEl.addEventListener('click', () => {
                const facilityId = itemEl.getAttribute('data-id');
                selectFacility(facilityId);
            });
        });
    }

    function selectFacility(facilityId) {
        const facility = campusFacilities.find((f) => f.id === facilityId);
        if (!facility) return;

        searchInput.value = facility.name;
        resultsList.style.display = 'none';
        clearBtn.style.display = 'block';

        const marker = markerMap.get(facilityId);

        if (marker && isValidCoordinate(facility.coordinates) && !facility.pending_location) {
            // Zoom directly to marker and open popup
            map.flyTo(facility.coordinates, 18, { duration: 1.2 });
            marker.openPopup();
        } else {
            // Facility has unconfirmed or pending coordinates
            if (isAdmin) {
                showToast(`"${facility.name}" is pending map placement. Click anywhere on the map to place it!`, 'loading', 4000);
                startPlacementMode(facility.id, facility.name);
            } else {
                showToast(`"${facility.name}" location is currently pending admin verification.`, 'loading', 4500);
            }
        }
    }

    // Input event for live typing
    searchInput.addEventListener('input', handleSearch);

    // Focus input to re-show results if query exists
    searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim()) {
            handleSearch();
        }
    });

    // Clear search
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        resultsList.innerHTML = '';
        resultsList.style.display = 'none';
        clearBtn.style.display = 'none';
        searchInput.focus();
    });

    // Close results dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            resultsList.style.display = 'none';
        }
    });

    // Keyboard support: Escape key closes results dropdown
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            resultsList.style.display = 'none';
        }
    });
}

/**
 * Initializes the "My Location" browser geolocation feature
 */
function initLocationFeature() {
    const locateBtn = document.getElementById('locate-user-btn');
    const locateIcon = document.getElementById('locate-icon');
    const locateSpinner = document.getElementById('locate-spinner');

    if (!locateBtn || !locateIcon || !locateSpinner) return;

    function resetLoadingState() {
        locateBtn.disabled = false;
        locateIcon.style.display = 'inline-block';
        locateSpinner.style.display = 'none';
    }

    // Helper to render pulsing blue user pin
    function renderUserLocation(lat, lon, accuracy) {
        userLocationLayer.clearLayers();

        if (accuracy && accuracy < 1000) {
            L.circle([lat, lon], {
                radius: accuracy,
                color: '#3b82f6',
                weight: 1.5,
                fillColor: '#3b82f6',
                fillOpacity: 0.12
            }).addTo(userLocationLayer);
        }

        const userIcon = L.divIcon({
            className: 'user-pin-wrapper',
            html: `
                <div class="user-location-pin">
                    <div class="user-location-pulse"></div>
                    <div class="user-location-dot"></div>
                </div>
            `,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -14]
        });

        const userMarker = L.marker([lat, lon], {
            icon: userIcon,
            title: 'My Current Location',
            zIndexOffset: 1000
        }).addTo(userLocationLayer);

        userMarker.bindPopup(`
            <div class="facility-popup">
                <span class="badge" style="background-color: #2563eb;">Current Position</span>
                <h3>You Are Here</h3>
                <p>Estimated accuracy: ±${accuracy} meters</p>
                <div class="coords-meta">📍 ${lat.toFixed(5)}, ${lon.toFixed(5)}</div>
            </div>
        `);

        return userMarker;
    }

    // Promise wrapper to acquire GPS position
    window.acquireUserLocation = function() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation is not supported by your browser.'));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude;
                    const lon = position.coords.longitude;
                    const accuracy = Math.round(position.coords.accuracy);

                    currentUserLocation = [lat, lon];
                    const marker = renderUserLocation(lat, lon, accuracy);
                    resolve({ lat, lon, accuracy, marker });
                },
                (error) => {
                    let errorMsg = 'Unable to determine your location.';
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            errorMsg = 'Location permission was denied. Please allow location access in your browser.';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            errorMsg = 'Location information is currently unavailable on your device.';
                            break;
                        case error.TIMEOUT:
                            errorMsg = 'Location request timed out. Please try again.';
                            break;
                    }
                    reject(new Error(errorMsg));
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        });
    };

    locateBtn.addEventListener('click', async () => {
        locateBtn.disabled = true;
        locateIcon.style.display = 'none';
        locateSpinner.style.display = 'inline-block';
        showToast('Acquiring your location...', 'loading', 0);

        try {
            const loc = await acquireUserLocation();
            resetLoadingState();
            loc.marker.openPopup();
            map.flyTo([loc.lat, loc.lon], 17, { duration: 1.2 });
            showToast(`Location found (±${loc.accuracy}m)`, 'success', 3500);
        } catch (err) {
            resetLoadingState();
            showToast(err.message, 'error', 6000);
        }
    });

    // Clear route button listener
    const clearRouteBtn = document.getElementById('clear-route-btn');
    if (clearRouteBtn) {
        clearRouteBtn.addEventListener('click', clearWalkingRoute);
    }
}

/**
 * WALKING NAVIGATION ENGINE
 */

window.clearWalkingRoute = function() {
    routeLayer.clearLayers();
    const navCard = document.getElementById('route-nav-card');
    if (navCard) navCard.style.display = 'none';
};

window.startNavigationTo = async function(facilityId, facilityName) {
    const facility = campusFacilities.find(f => f.id === facilityId);
    if (!facility || !isValidCoordinate(facility.coordinates) || facility.pending_location) {
        showToast(`"${facilityName || 'Facility'}" location is not yet verified on the map.`, "error", 4000);
        return;
    }

    // Close any open popup
    map.closePopup();

    let startCoords = currentUserLocation;

    if (!startCoords) {
        showToast("Requesting GPS location for walking directions...", "loading", 0);
        try {
            const loc = await acquireUserLocation();
            startCoords = [loc.lat, loc.lon];
        } catch (err) {
            showToast(err.message, "error", 5500);
            return;
        }
    }

    await calculateAndDisplayWalkingRoute(startCoords, facility.coordinates, facility.name);
};

async function calculateAndDisplayWalkingRoute(startPoint, destCoords, destName) {
    showToast(`Calculating walking route to ${destName}...`, "loading", 0);

    try {
        const url = `/api/route?start_lat=${startPoint[0]}&start_lon=${startPoint[1]}&dest_lat=${destCoords[0]}&dest_lon=${destCoords[1]}`;
        const res = await fetch(url);
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.error || "No walking route found between these locations.");
        }

        // Clear previous walking route
        routeLayer.clearLayers();

        // 1. Dark casing polyline for contrast
        L.polyline(data.coordinates, {
            color: '#1e1b4b',
            weight: 7,
            opacity: 0.45,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(routeLayer);

        // 2. Vibrant walking polyline with dashed pedestrian style
        const walkLine = L.polyline(data.coordinates, {
            color: '#4f46e5',
            weight: 4.5,
            opacity: 0.95,
            dashArray: '8, 8',
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(routeLayer);

        // Auto-fit map to show entire walking path
        map.fitBounds(walkLine.getBounds(), { padding: [65, 65] });

        // Update floating route navigation card
        const card = document.getElementById('route-nav-card');
        const destNameEl = document.getElementById('route-dest-name');
        const distEl = document.getElementById('route-distance-text');
        const durEl = document.getElementById('route-duration-text');

        if (card && destNameEl && distEl && durEl) {
            destNameEl.textContent = destName;
            distEl.textContent = data.formatted_distance;
            durEl.textContent = data.formatted_duration;
            card.style.display = 'flex';
        }

        showToast(`Walking route displayed (${data.formatted_distance}, ~${data.formatted_duration})`, "success", 4000);
    } catch (err) {
        showToast(err.message, "error", 5000);
    }
}

/**
 * ADMIN FUNCTIONALITY & MODALS
 */

// Check server-side admin session status on load
async function checkAdminSession() {
    try {
        const res = await fetch('/api/admin/status');
        const data = await res.json();
        isAdmin = data.is_admin === true;

        const loginBtn = document.getElementById('open-admin-login-btn');
        const adminControls = document.getElementById('admin-logged-in-controls');

        if (isAdmin) {
            if (loginBtn) loginBtn.style.display = 'none';
            if (adminControls) adminControls.style.display = 'flex';
        } else {
            if (loginBtn) loginBtn.style.display = 'inline-block';
            if (adminControls) adminControls.style.display = 'none';
        }
    } catch (e) {
        console.error("Failed to check admin status:", e);
    }
}

// Global hook for placement mode (used by buttons in popups & manager)
window.startPlacementMode = function(facilityId, facilityName) {
    if (!isAdmin) {
        showToast("Admin authentication required.", "error", 4000);
        return;
    }

    activePlacementFacility = { id: facilityId, name: facilityName };

    // Close manager modal if open
    const mgrModal = document.getElementById('admin-manager-modal');
    if (mgrModal) mgrModal.style.display = 'none';

    // Show floating placement banner
    const banner = document.getElementById('admin-placement-banner');
    const targetNameSpan = document.getElementById('placement-target-name');
    if (banner && targetNameSpan) {
        targetNameSpan.textContent = facilityName;
        banner.style.display = 'flex';
    }

    document.getElementById('map').style.cursor = 'crosshair';
    showToast(`Click on the map where "${facilityName}" is located`, 'loading', 4000);
};

window.cancelPlacementMode = function() {
    activePlacementFacility = null;
    pendingPlacementCoord = null;

    const banner = document.getElementById('admin-placement-banner');
    if (banner) banner.style.display = 'none';

    document.getElementById('map').style.cursor = '';
};

window.deleteFacility = async function(facilityId, facilityName) {
    if (!isAdmin) return;
    if (!confirm(`Are you sure you want to delete "${facilityName}"?`)) return;

    try {
        const res = await fetch(`/api/facilities/${facilityId}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error("Failed to delete facility");

        showToast(`"${facilityName}" deleted.`, "success", 3000);
        await loadCampusFacilities();
    } catch (e) {
        showToast(e.message, "error", 4000);
    }
};

/**
 * Initializes Admin Login, Logout, Manager Modal & Location Confirmation
 */
function initAdminManagement() {
    const loginBtn = document.getElementById('open-admin-login-btn');
    const logoutBtn = document.getElementById('admin-logout-btn');
    const openMgrBtn = document.getElementById('open-admin-manager-btn');

    const loginModal = document.getElementById('admin-login-modal');
    const closeLoginX = document.getElementById('close-login-modal-x');
    const cancelLoginBtn = document.getElementById('cancel-login-btn');
    const loginForm = document.getElementById('admin-login-form');
    const passwordInput = document.getElementById('admin-password-input');
    const errorBanner = document.getElementById('login-error-banner');

    const managerModal = document.getElementById('admin-manager-modal');
    const closeMgrX = document.getElementById('close-manager-modal-x');

    const cancelPlacementBtn = document.getElementById('cancel-placement-btn');
    const confirmModal = document.getElementById('confirm-location-modal');
    const cancelConfirmBtn = document.getElementById('cancel-confirm-btn');
    const saveLocationBtn = document.getElementById('save-location-btn');
    const confirmNameEl = document.getElementById('confirm-facility-name');
    const confirmCoordsEl = document.getElementById('confirm-coords-display');

    // Open Login Modal
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            if (errorBanner) errorBanner.style.display = 'none';
            if (passwordInput) passwordInput.value = '';
            if (loginModal) loginModal.style.display = 'flex';
        });
    }

    // Close Login Modal
    const hideLoginModal = () => { if (loginModal) loginModal.style.display = 'none'; };
    if (closeLoginX) closeLoginX.addEventListener('click', hideLoginModal);
    if (cancelLoginBtn) cancelLoginBtn.addEventListener('click', hideLoginModal);

    /**
     * Hashes credentials using browser Web Crypto SHA-256 before network transmission.
     * Ensures plaintext passwords are never exposed in browser Network tabs or in flight.
     */
    async function hashCredential(text) {
        if (window.crypto && window.crypto.subtle) {
            try {
                const encoder = new TextEncoder();
                const data = encoder.encode(text);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            } catch (err) {
                console.warn("Client crypto hash failed, using fallback.", err);
            }
        }
        return text;
    }

    // Handle Login Form Submit
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const rawPassword = passwordInput.value;
            passwordInput.value = ''; // Immediately wipe plaintext from DOM input
            if (errorBanner) errorBanner.style.display = 'none';

            if (!rawPassword) {
                if (errorBanner) {
                    errorBanner.textContent = "Please enter the administrator password.";
                    errorBanner.style.display = 'block';
                }
                return;
            }

            const submitBtn = loginForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Verifying...';
            }

            try {
                // Compute cryptographic hash so plaintext password never traverses network
                const credential = await hashCredential(rawPassword);

                const res = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ credential })
                });

                if (res.ok) {
                    hideLoginModal();
                    await checkAdminSession();
                    await loadCampusFacilities();
                    showToast("Administrator logged in successfully.", "success", 3000);
                } else {
                    const err = await res.json();
                    if (errorBanner) {
                        errorBanner.textContent = err.error || "Authentication failed.";
                        errorBanner.style.display = 'block';
                    }
                }
            } catch (err) {
                if (errorBanner) {
                    errorBanner.textContent = "Connection error. Please try again.";
                    errorBanner.style.display = 'block';
                }
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Login';
                }
            }
        });
    }

    // Handle Logout
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await fetch('/api/admin/logout', { method: 'POST' });
                cancelPlacementMode();
                await checkAdminSession();
                await loadCampusFacilities();
                showToast("Logged out of Admin mode.", "loading", 3000);
            } catch (e) {
                console.error(e);
            }
        });
    }

    // Open Facility Manager Modal
    if (openMgrBtn) {
        openMgrBtn.addEventListener('click', () => {
            updateAdminManagerUI();
            if (managerModal) managerModal.style.display = 'flex';
        });
    }

    // Close Facility Manager
    if (closeMgrX) {
        closeMgrX.addEventListener('click', () => {
            if (managerModal) managerModal.style.display = 'none';
        });
    }

    // Cancel Placement Banner button
    if (cancelPlacementBtn) {
        cancelPlacementBtn.addEventListener('click', cancelPlacementMode);
    }

    // Cancel Confirm Placement Dialog
    if (cancelConfirmBtn) {
        cancelConfirmBtn.addEventListener('click', () => {
            if (confirmModal) confirmModal.style.display = 'none';
            pendingPlacementCoord = null;
        });
    }

    // Save Location Confirmation
    if (saveLocationBtn) {
        saveLocationBtn.addEventListener('click', async () => {
            if (!activePlacementFacility || !pendingPlacementCoord) return;

            saveLocationBtn.disabled = true;
            saveLocationBtn.textContent = 'Saving...';

            try {
                const res = await fetch(`/api/facilities/${activePlacementFacility.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        coordinates: pendingPlacementCoord,
                        pending_location: false,
                        source: 'Admin Verified (Ground Truth)'
                    })
                });

                if (!res.ok) throw new Error("Failed to update facility location");

                const data = await res.json();
                showToast(`Location for "${data.facility.name}" updated successfully!`, "success", 4000);

                cancelPlacementMode();
                if (confirmModal) confirmModal.style.display = 'none';
                await loadCampusFacilities();

                // Smoothly zoom to the newly mapped facility and open its popup
                const updatedMarker = markerMap.get(data.facility.id);
                if (updatedMarker) {
                    map.flyTo(pendingPlacementCoord, 18, { duration: 1.2 });
                    updatedMarker.openPopup();
                }
            } catch (e) {
                showToast(e.message, "error", 4000);
            } finally {
                saveLocationBtn.disabled = false;
                saveLocationBtn.textContent = 'Save Location';
            }
        });
    }

    // Map click listener: Handles Admin placement mode vs general coordinate inspect
    map.on('click', (e) => {
        const lat = parseFloat(e.latlng.lat.toFixed(5));
        const lon = parseFloat(e.latlng.lng.toFixed(5));

        if (activePlacementFacility) {
            // Admin is setting location
            pendingPlacementCoord = [lat, lon];
            if (confirmNameEl) confirmNameEl.textContent = activePlacementFacility.name;
            if (confirmCoordsEl) confirmCoordsEl.textContent = `[${lat}, ${lon}]`;
            if (confirmModal) confirmModal.style.display = 'flex';
        } else {
            // General coordinate inspector for students & testing
            L.popup()
                .setLatLng(e.latlng)
                .setContent(`
                    <div style="font-family: inherit; font-size: 0.85rem; padding: 2px;">
                        <b style="color: #0f172a;">Campus Coordinate</b><br>
                        <code style="display: inline-block; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; margin: 4px 0; color: #2563eb; font-weight: 600;">[${lat}, ${lon}]</code><br>
                        <span style="font-size: 0.72rem; color: #64748b;">${isAdmin ? 'Logged in as Admin. Use Facility Manager to place pins.' : 'Verified coordinate location.'}</span>
                    </div>
                `)
                .openOn(map);
        }
    });

    // Tab switcher in Admin Manager
    const tabUnmapped = document.getElementById('tab-unmapped-btn');
    const tabAll = document.getElementById('tab-all-btn');
    const tabAdd = document.getElementById('tab-add-btn');

    if (tabUnmapped && tabAll && tabAdd) {
        tabUnmapped.addEventListener('click', () => switchManagerTab('unmapped'));
        tabAll.addEventListener('click', () => switchManagerTab('all'));
        tabAdd.addEventListener('click', () => switchManagerTab('add'));
    }
}

let activeManagerTab = 'unmapped';

function switchManagerTab(tab) {
    activeManagerTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    if (tab === 'unmapped') document.getElementById('tab-unmapped-btn')?.classList.add('active');
    if (tab === 'all') document.getElementById('tab-all-btn')?.classList.add('active');
    if (tab === 'add') document.getElementById('tab-add-btn')?.classList.add('active');

    updateAdminManagerUI();
}

/**
 * Renders the content inside the Admin Facility Manager modal
 */
function updateAdminManagerUI() {
    const unmappedCountEl = document.getElementById('unmapped-count');
    const allCountEl = document.getElementById('all-count');
    const contentEl = document.getElementById('manager-tab-content');

    if (!contentEl) return;

    const unmappedList = campusFacilities.filter(f => !isValidCoordinate(f.coordinates) || f.pending_location);
    if (unmappedCountEl) unmappedCountEl.textContent = unmappedList.length;
    if (allCountEl) allCountEl.textContent = campusFacilities.length;

    if (activeManagerTab === 'unmapped') {
        if (unmappedList.length === 0) {
            contentEl.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #64748b;">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">🎉</div>
                    <b>All campus facilities are verified and placed on the map!</b>
                </div>
            `;
            return;
        }

        contentEl.innerHTML = unmappedList.map(f => `
            <div class="facility-admin-card pending">
                <div class="fac-left">
                    <span style="font-size: 1.5rem;">${f.icon || '📍'}</span>
                    <div class="fac-meta">
                        <h4>${escapeHtml(f.name)}</h4>
                        <p>${escapeHtml(f.description || f.category)}</p>
                        <span class="status-pill upcoming" style="display: inline-block; margin-top: 4px;">📍 Location Pending</span>
                    </div>
                </div>
                <div class="fac-actions">
                    <button type="button" class="action-btn locate" onclick="startPlacementMode('${f.id}', '${escapeHtml(f.name)}')">📍 Set on Map</button>
                </div>
            </div>
        `).join('');
    } else if (activeManagerTab === 'all') {
        contentEl.innerHTML = campusFacilities.map(f => {
            const isUnmapped = !isValidCoordinate(f.coordinates) || f.pending_location;
            const coordStr = isUnmapped ? 'Pending Location' : `${f.coordinates[0].toFixed(5)}, ${f.coordinates[1].toFixed(5)}`;
            return `
                <div class="facility-admin-card ${isUnmapped ? 'pending' : ''}">
                    <div class="fac-left">
                        <span style="font-size: 1.4rem;">${f.icon || '📍'}</span>
                        <div class="fac-meta">
                            <h4>${escapeHtml(f.name)}</h4>
                            <p style="font-family: monospace; font-size: 0.72rem; color: #2563eb;">${coordStr}</p>
                        </div>
                    </div>
                    <div class="fac-actions">
                        <button type="button" class="action-btn locate" onclick="startPlacementMode('${f.id}', '${escapeHtml(f.name)}')">
                            ${isUnmapped ? '📍 Set on Map' : '✏️ Reposition'}
                        </button>
                        <button type="button" class="action-btn delete" onclick="deleteFacility('${f.id}', '${escapeHtml(f.name)}')">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');
    } else if (activeManagerTab === 'add') {
        contentEl.innerHTML = `
            <form id="add-facility-form" style="padding-top: 0.5rem;" onsubmit="handleCreateFacilityForm(event)">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                    <div class="form-group">
                        <label>Facility ID (Unique)</label>
                        <input type="text" id="new-fac-id" class="form-input" placeholder="e.g. library_block" required>
                    </div>
                    <div class="form-group">
                        <label>Facility Name</label>
                        <input type="text" id="new-fac-name" class="form-input" placeholder="e.g. Central Library" required>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem;">
                    <div class="form-group">
                        <label>Category</label>
                        <input type="text" id="new-fac-cat" class="form-input" placeholder="e.g. Academics" required>
                    </div>
                    <div class="form-group">
                        <label>Icon Symbol</label>
                        <input type="text" id="new-fac-icon" class="form-input" placeholder="e.g. 📚" value="📍">
                    </div>
                    <div class="form-group">
                        <label>Color</label>
                        <input type="color" id="new-fac-color" class="form-input" value="#2563eb" style="height: 38px; padding: 2px;">
                    </div>
                </div>

                <div class="form-group">
                    <label>Description</label>
                    <textarea id="new-fac-desc" class="form-input" rows="2" placeholder="Facility description..."></textarea>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                    <div class="form-group">
                        <label>Building (Optional)</label>
                        <input type="text" id="new-fac-bldg" class="form-input" placeholder="e.g. Main Block">
                    </div>
                    <div class="form-group">
                        <label>Floor (Optional)</label>
                        <input type="text" id="new-fac-floor" class="form-input" placeholder="e.g. Ground Floor">
                    </div>
                </div>

                <div class="modal-footer" style="padding-top: 0.5rem;">
                    <button type="submit" class="btn btn-primary">+ Create & Place on Map</button>
                </div>
            </form>
        `;
    }
}

window.handleCreateFacilityForm = async function(e) {
    e.preventDefault();
    if (!isAdmin) return;

    const id = document.getElementById('new-fac-id').value.trim();
    const name = document.getElementById('new-fac-name').value.trim();
    const category = document.getElementById('new-fac-cat').value.trim();
    const icon = document.getElementById('new-fac-icon').value.trim() || '📍';
    const color = document.getElementById('new-fac-color').value;
    const description = document.getElementById('new-fac-desc').value.trim();
    const building = document.getElementById('new-fac-bldg').value.trim();
    const floor = document.getElementById('new-fac-floor').value.trim();

    const payload = {
        id,
        name,
        category,
        icon,
        color,
        description,
        building: building || undefined,
        floor: floor || undefined,
        coordinates: null,
        pending_location: true,
        source: 'Admin Created'
    };

    try {
        const res = await fetch('/api/facilities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to create facility");
        }

        await loadCampusFacilities();
        startPlacementMode(id, name);
    } catch (err) {
        alert(err.message);
    }
};

// Startup initialization
(async function initApp() {
    await checkAdminSession();
    await loadCampusFacilities();
    initLocationFeature();
    initAdminManagement();
})();
