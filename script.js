document.addEventListener('DOMContentLoaded', function() {
  const supabase = window.supabaseClient;
  if (!supabase) {
    console.error("Supabase client is not initialized. Check index.html.");
    alert("A critical error occurred. Please refresh the page.");
    return;
  }

  // --- State Management ---
  let state = {
    map: null,
    userMarkers: {},
    locationWatchId: null,
    currentUserLocation: null,
    routingControl: null,
    userProfile: null,
    isStartingLocation: false, // Flag to prevent double-clicks
    userCache: {}, // Cache for user names
  };

  // --- DOM Elements (cached for performance) ---
  const DOMElements = {
    authContainer: document.getElementById('auth-container'),
    navLinks: document.querySelector('.nav-links'),
    menuToggle: document.querySelector('.menu-toggle'),
    userProfileArea: document.getElementById('user-profile-area'),
    galleryGrid: document.querySelector('.gallery-grid'),
    notesContainer: document.querySelector('.notes-container'),
    timelineContainer: document.querySelector('.timeline-container'),
    favoritesList: document.querySelector('.favorites-list'),
    uploadModal: document.getElementById('upload-modal'),
    imageViewerModal: document.getElementById('image-viewer-modal'),
    loginModal: document.getElementById('login-modal'),
    routeInfoBox: document.getElementById('route-info-box'),
    locationNotice: document.getElementById('location-notice-text'),
    addLocationButton: document.getElementById('add-location-button'),
  };

  // --- Helper Functions ---
  function formatTimeAgo(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";
    if (seconds < 10) return "just now";
    return Math.floor(seconds) + " seconds ago";
  }

  async function getUserName(userId) {
    if (!userId) return "Someone";
    if (state.userCache[userId]) return state.userCache[userId];

    const { data, error } = await supabase.from('profiles').select('display_name').eq('id', userId).single();
    
    if (error || !data?.display_name) {
      console.warn(`Could not fetch name for user ${userId}:`, error?.message);
      return "A user"; // Fallback
    }
    const firstName = data.display_name.split(' ')[0];
    state.userCache[userId] = firstName;
    return firstName;
  }

  // --- UI & State Updates ---
  async function updateUIForAuthState(user) {
    const isLoggedIn = !!user; // true if user object exists, false otherwise
    document.body.classList.toggle('logged-in', isLoggedIn);
    document.body.classList.toggle('logged-out', !isLoggedIn);

    // Clear previous auth button to prevent duplicate listeners
    DOMElements.authContainer.innerHTML = ''; 

    if (isLoggedIn) {
      // --- LOGGED-IN STATE ---
      console.log('User signed in:', user.user_metadata.full_name);

      // Create and configure the Logout button
      const logoutButton = document.createElement('a');
      logoutButton.href = '#';
      logoutButton.id = 'logout-button';
      logoutButton.className = 'cta-button';
      logoutButton.textContent = 'Logout';
      logoutButton.addEventListener('click', async (e) => {
        e.preventDefault();
        if (confirm('Are you sure you want to log out?')) {
          await supabase.auth.signOut();
          location.reload(); // Reload the page for a clean, logged-out state
        }
      });
      DOMElements.authContainer.appendChild(logoutButton);

      // Fetch profile and initialize user-specific features
      state.userProfile = await getProfile(user.id);
      if (DOMElements.userProfileArea) {
        document.getElementById('user-name').textContent = user.user_metadata.full_name;
        document.getElementById('user-icon').src = state.userProfile?.icon_url || 'https://via.placeholder.com/50';
      }

      // Initialize map and location features now that user is logged in
      if (document.getElementById('map') && !state.map) {
        initializeMap();
        await loadInitialLocations();
      }
      if (!window.locationChannel) {
        window.locationChannel = listenForUserLocations();
      }
    } else {
      // --- LOGGED-OUT STATE ---
      console.log('User signed out.');

      // Create and configure the Login button
      const loginButton = document.createElement('a');
      loginButton.href = '#';
      loginButton.id = 'login-button';
      loginButton.className = 'cta-button';
      loginButton.textContent = 'Login';
      loginButton.addEventListener('click', (e) => {
        e.preventDefault();
        DOMElements.loginModal.style.display = 'flex'; // Open the login choice modal
      });
      DOMElements.authContainer.appendChild(loginButton);

      state.userProfile = null;
      stopLocationSharing();
    }
  }

  // --- Profile Management ---
  async function handleIconUpload(file) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !file) return;
    const user = session.user;
    const statusElem = document.getElementById('upload-status');
    statusElem.textContent = 'Uploading...';
    const filePath = `${user.id}/${file.name}`;
    try {
      const { error: uploadError } = await supabase.storage.from('media').upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(filePath);
      const { data: updatedProfile, error: dbError } = await supabase.from('profiles').upsert({ id: user.id, icon_url: publicUrl, display_name: user.user_metadata.full_name }).select().single();
      if (dbError) throw dbError;
      await supabase.from('locations').update({ icon_url: publicUrl }).eq('id', user.id);
      state.userProfile = updatedProfile;
      document.getElementById('user-icon').src = publicUrl;
      statusElem.textContent = 'Upload complete!';
    } catch (error) {
      console.error("Upload failed:", error);
      statusElem.textContent = 'Upload failed.';
    }
  }

  async function getProfile(userId) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error && error.code !== 'PGRST116') console.error('Error fetching profile:', error);
    return data;
  }

  // --- Map and Location Logic ---
  function initializeMap() {
    if (state.map) return;
    const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>' });
    const osmStreetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' });
    const esriSatelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' });
    
    // Google Maps Layers (requires Leaflet.GridLayer.GoogleMutant plugin)
    const googleStreets = L.gridLayer.googleMutant({ type: 'roadmap' }); // 'roadmap', 'satellite', 'terrain', 'hybrid'
    const googleSatellite = L.gridLayer.googleMutant({ type: 'satellite' });
    const googleHybrid = L.gridLayer.googleMutant({ type: 'hybrid' });

    state.map = L.map('map', { zoomControl: false }).setView([51.505, -0.09], 2);
    darkLayer.addTo(state.map);
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);
    const baseLayers = { "Dark": darkLayer, "Street (OSM)": osmStreetLayer, "Satellite (Esri)": esriSatelliteLayer, "Google Street": googleStreets, "Google Satellite": googleSatellite, "Google Hybrid": googleHybrid };
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(state.map);
  }

  async function loadInitialLocations() {
    const { data: locations, error } = await supabase.from('locations').select('*');
    if (error) return console.error('Error fetching initial locations:', error);
    locations.forEach(userData => updateUserMarker(userData));
    const allMarkers = Object.values(state.userMarkers);
    if (allMarkers.length > 0) {
      const group = new L.featureGroup(allMarkers);
      state.map.fitBounds(group.getBounds().pad(0.5));
    }
  }

  // --- New Location Logic ---
  function showLocationNotice(message, isError = false) {
    if (!DOMElements.locationNotice) return;
    DOMElements.locationNotice.textContent = message;
    DOMElements.locationNotice.style.color = isError ? 'var(--danger)' : 'var(--text-light)';
    DOMElements.locationNotice.style.display = message ? 'block' : 'none';
  }

  async function startLocationSharing() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return showLocationNotice("You must be logged in to share your location.", true);
    if (state.locationWatchId || state.isStartingLocation) return;
    if (!navigator.geolocation) return showLocationNotice("Geolocation is not supported by your browser.", true);

    state.isStartingLocation = true;
    DOMElements.addLocationButton.textContent = 'Starting...';
    showLocationNotice('Requesting location access. Please check your browser for a permission prompt.');

    // This timeout gives the user a moment to read the notice before the browser prompt appears.
    setTimeout(() => {
        state.locationWatchId = navigator.geolocation.watchPosition(
            async (position) => {
                // --- On Success ---
                state.isStartingLocation = false;
                showLocationNotice(''); // Clear notice on success
                document.body.classList.add('is-sharing-location');
                DOMElements.addLocationButton.textContent = 'Share Live Location'; // Reset button text

                const { latitude, longitude } = position.coords;
                state.currentUserLocation = [latitude, longitude];

                // If a route is active, update it
                if (state.routingControl) {
                    state.routingControl.spliceWaypoints(0, 1, L.latLng(latitude, longitude));
                }

                await supabase.from('locations').upsert({
                    id: session.user.id,
                    lat: latitude,
                    lng: longitude,
                    display_name: session.user.user_metadata.full_name,
                    icon_url: state.userProfile?.icon_url || 'https://via.placeholder.com/50',
                    updated_at: new Date().toISOString()
                });
            },
            (error) => {
                // --- On Error ---
                console.error("Geolocation error:", error);
                let message = "An unknown error occurred while getting your location.";
                if (error.code === error.PERMISSION_DENIED) {
                    message = "Location access was denied. To use this feature, please enable location permissions for this site in your browser settings.";
                }
                showLocationNotice(message, true);
                stopLocationSharing(); // Clean up state
            },
            // --- Options ---
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
    }, 500); // 0.5 second delay
  }

  function stopLocationSharing() {
    if (state.locationWatchId) {
      navigator.geolocation.clearWatch(state.locationWatchId);
      state.locationWatchId = null;
      console.log('Stopped sharing location.');
    }
    if (state.routingControl) {
      state.map.removeControl(state.routingControl);
      state.routingControl = null;
      if (DOMElements.routeInfoBox) DOMElements.routeInfoBox.style.display = 'none';
    }
    document.body.classList.remove('is-sharing-location');
    showLocationNotice(''); // Clear any notices
    state.isStartingLocation = false;
    DOMElements.addLocationButton.textContent = 'Share Live Location';
  }

  function listenForUserLocations() {
    if (window.locationChannel) supabase.removeChannel(window.locationChannel);
    window.locationChannel = supabase.channel('locations-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, payload => {
        updateUserMarker(payload.new);
      })
      .subscribe();
    return window.locationChannel;
  }

  function updateUserMarker(userData) {
    if (!userData || !state.map) return;
    const uid = userData.id;
    if (state.userMarkers[uid]) {
        // Just update position and popup content instead of removing/re-adding
        state.userMarkers[uid].setLatLng([userData.lat, userData.lng]);
        state.userMarkers[uid].setPopupContent(createPopupContent(userData));
        return;
    }
    const customIcon = L.icon({ iconUrl: userData.icon_url, iconSize: [40, 40], iconAnchor: [20, 40], popupAnchor: [0, -40] });
    const marker = L.marker([userData.lat, userData.lng], { icon: customIcon }).addTo(state.map).bindPopup(createPopupContent(userData));
    state.userMarkers[uid] = marker;
  }

  function drawRoute(destination, mode) {
    if (!state.currentUserLocation) return showLocationNotice("Your location is not available yet. Please wait a moment and try again.", true);
    if (state.routingControl) state.map.removeControl(state.routingControl);
    state.routingControl = L.Routing.control({
      waypoints: [L.latLng(state.currentUserLocation[0], state.currentUserLocation[1]), L.latLng(destination[0], destination[1])],
      routeWhileDragging: true,
      router: L.Routing.osrmv1({ serviceUrl: `https://router.project-osrm.org/route/v1`, profile: mode }),
      createMarker: () => null,
      lineOptions: { styles: [{ color: '#1DB954', opacity: 0.8, weight: 6 }] },
      show: false,
      addWaypoints: false
    }).addTo(state.map);

    state.routingControl.on('routesfound', function(e) {
      const route = e.routes[0];
      const summary = route.summary;
      const totalSeconds = summary.totalTime;
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const etaString = (hours > 0 ? `${hours} hr ` : '') + `${minutes} min`;
      const distanceKm = (summary.totalDistance / 1000).toFixed(1);
      document.getElementById('route-eta').textContent = etaString;
      document.getElementById('route-distance').textContent = `${distanceKm} km`;
      if (DOMElements.routeInfoBox) DOMElements.routeInfoBox.style.display = 'block';
    });
  }

  function createPopupContent(userData) {
    const timeAgo = formatTimeAgo(userData.updated_at);
    return `
      <b>${userData.display_name}</b><br>
      <span class="timestamp">Updated ${timeAgo}</span>
      <div class="route-buttons-container"><button class="route-button" data-lat="${userData.lat}" data-lng="${userData.lng}" data-mode="walking">Walk</button> <button class="route-button" data-lat="${userData.lat}" data-lng="${userData.lng}" data-mode="driving">Drive</button></div>
    `;
  }

  // --- Gallery Logic ---
  async function loadGallery() {
    if (!DOMElements.galleryGrid) return;
    const { data: { session } } = await supabase.auth.getSession();
    // Select user_id to know who uploaded the photo
    const { data, error } = await supabase.from('gallery').select('id, url, user_id').order('created_at', { ascending: false });
    if (error) return console.error('Error loading gallery:', error);
    DOMElements.galleryGrid.innerHTML = '';

    for (const image of data) {
      const creatorName = await getUserName(image.user_id);
      const itemDiv = document.createElement('div');
      itemDiv.className = 'gallery-item';
      
      const img = document.createElement('img');
      img.src = image.url; img.alt = 'Gallery moment';
      itemDiv.appendChild(img);

      // Add creator name overlay
      const creatorOverlay = document.createElement('div');
      creatorOverlay.className = 'creator-overlay';
      creatorOverlay.textContent = `Added by ${creatorName}`;
      itemDiv.appendChild(creatorOverlay);

      // Add delete button if the current user owns the photo
      if (session && session.user.id === image.user_id) {
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-photo-button';
        deleteButton.innerHTML = '&times;'; // A nice 'x' character
        deleteButton.dataset.imageId = image.id;
        itemDiv.appendChild(deleteButton);
      }

      DOMElements.galleryGrid.appendChild(itemDiv);
    }
  }

  async function deletePhoto(imageId) {
    if (!imageId) return alert("Image ID is missing. Deletion aborted.");
    try {
      const { data: image, error: fetchError } = await supabase.from('gallery').select('url, user_id').eq('id', imageId).single();
      if (fetchError) throw fetchError;

      // Security check: ensure only the owner can delete
      const { data: { user } } = await supabase.auth.getUser();
      if (user.id !== image.user_id) {
        return alert("You can only delete photos you have uploaded.");
      }

      const urlPath = new URL(image.url).pathname;
      const filePath = urlPath.substring(urlPath.indexOf('/media/') + '/media/'.length);
      const { error: dbError } = await supabase.from('gallery').delete().match({ id: imageId });
      if (dbError) throw dbError;
      const { error: storageError } = await supabase.storage.from('media').remove([filePath]);
      if (storageError) throw storageError;
      loadGallery();
    } catch (error) {
      console.error('Error deleting photo:', error);
      alert('Error: Could not delete the photo.');
    }
  }

  // --- Content Loading ---
  const contentLoaders = {
    notes: async () => {
      const { data } = await supabase.from('notes').select('*, profiles(display_name)').order('created_at', { ascending: false });
      if (!data) return;
      DOMElements.notesContainer.innerHTML = data.length > 0 ? data.map(note => {
        const creatorName = note.profiles?.display_name?.split(' ')[0] || 'A user';
        return `<div class="note-card">
                  <p>${note.content}</p>
                  <div class="timestamp">From ${creatorName}, ${formatTimeAgo(note.created_at)}</div>
                </div>`;
      }).join('') : '<p>No notes yet. Add one soon!</p>';
    },
    timeline: async () => {
      const { data } = await supabase.from('timeline').select('*, profiles(display_name)').order('event_date', { ascending: true });
      if (!data) return;
      DOMElements.timelineContainer.innerHTML = data.length > 0 ? data.map(event => {
        const creatorName = event.profiles?.display_name?.split(' ')[0] || 'A user';
        return `<div class="timeline-item">
                  <div class="timeline-dot"></div>
                  <div class="timeline-content">
                    <div class="timeline-date">${new Date(event.event_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                    <h3>${event.title}</h3>
                    <p>${event.description}</p>
                    <div class="timestamp">Added by ${creatorName} ${formatTimeAgo(event.created_at)}</div>
                  </div>
                </div>`;
      }).join('') : '<p>Our story is just beginning...</p>';
    },
    favorites: async () => {
      const { data } = await supabase.from('favorites').select('*, profiles(display_name)').order('created_at', { ascending: false });
      if (!data) return;
      DOMElements.favoritesList.innerHTML = data.length > 0 ? data.map(fav => {
        const creatorName = fav.profiles?.display_name?.split(' ')[0] || 'A user';
        return `<li><span class="heart-icon">♥</span>${fav.item} <span class="timestamp">(Added by ${creatorName} ${formatTimeAgo(fav.created_at)})</span></li>`;
      }).join('') : '<p>No favorites listed yet.</p>';
    }
  };

  // --- New Content Submission Logic ---
  async function handleContentSubmission(event) {
    const target = event.target;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // Should not happen if form is visible, but a good safeguard

    let data, table, loader, fieldsToClear;

    if (target.id === 'submit-note-button') {
      const content = document.getElementById('new-note-text').value.trim();
      if (!content) return alert('Please write a note before adding.');
      data = { content, user_id: user.id };
      table = 'notes';
      loader = contentLoaders.notes;
      fieldsToClear = ['new-note-text'];
    } else if (target.id === 'submit-timeline-button') {
      const event_date = document.getElementById('new-timeline-date').value;
      const title = document.getElementById('new-timeline-title').value.trim();
      const description = document.getElementById('new-timeline-desc').value.trim();
      if (!event_date || !title) return alert('Please provide at least a date and a title for the event.');
      data = { event_date, title, description, user_id: user.id };
      table = 'timeline';
      loader = contentLoaders.timeline;
      fieldsToClear = ['new-timeline-date', 'new-timeline-title', 'new-timeline-desc'];
    } else if (target.id === 'submit-favorite-button') {
      const item = document.getElementById('new-favorite-text').value.trim();
      if (!item) return alert('Please enter a favorite thing.');
      data = { item, user_id: user.id };
      table = 'favorites';
      loader = contentLoaders.favorites;
      fieldsToClear = ['new-favorite-text'];
    } else {
      return; // Not a content submission button
    }

    const { error } = await supabase.from(table).insert([data]);
    if (error) return alert(`Error adding item: ${error.message}`);
    fieldsToClear.forEach(id => document.getElementById(id).value = '');
    await loader(); // Refresh the content
  }

  // --- Event Delegation ---
  document.addEventListener('click', async (event) => {
    const target = event.target;
    const id = target.id;

    if (target.closest('.menu-toggle')) {
        DOMElements.menuToggle.classList.toggle('active');
        DOMElements.navLinks.classList.toggle('active');
    }
    if (target.closest('.nav-links a')) {
        DOMElements.menuToggle.classList.remove('active');
        DOMElements.navLinks.classList.remove('active');
    }

    // Location
    if (id === 'add-location-button') startLocationSharing();
    if (id === 'stop-location-button') stopLocationSharing();
    if (target.classList.contains('route-button')) {
      drawRoute([target.dataset.lat, target.dataset.lng], target.dataset.mode);
      if (state.map) state.map.closePopup();
    }

    // Modals
    if (target.closest('#open-upload-modal-button')) DOMElements.uploadModal.style.display = 'flex';
    if (target.closest('.close-button') || target === DOMElements.uploadModal) DOMElements.uploadModal.style.display = 'none';
    if (target.closest('.close-button') || target === DOMElements.loginModal) DOMElements.loginModal.style.display = 'none';
    if (id === 'google-login-button') supabase.auth.signInWithOAuth({ provider: 'google' });
    if (id === 'github-login-button') supabase.auth.signInWithOAuth({ provider: 'github' });

    if (target.matches('.gallery-item img')) {
      DOMElements.imageViewerModal.style.display = 'flex';
      document.getElementById('fullscreen-image').src = target.src;
    }
    if (target.closest('.close-viewer-button') || target === DOMElements.imageViewerModal) DOMElements.imageViewerModal.style.display = 'none';

    // Gallery
    const deleteBtn = target.closest('.delete-photo-button');
    if (deleteBtn && confirm('Are you sure you want to delete this photo?')) {
      await deletePhoto(deleteBtn.dataset.imageId);
    }

    // Handle content submissions
    handleContentSubmission(event);

  });

  document.getElementById('icon-upload')?.addEventListener('change', (e) => handleIconUpload(e.target.files[0]));

  // --- App Initialization ---
  function init() {
    // Load all public content
    loadGallery();
    Object.values(contentLoaders).forEach(loader => loader());

    // Initialize map for everyone
    if (document.getElementById('map')) {
      initializeMap();
      loadInitialLocations();
    }

    // Set up scroll animations
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.content-section').forEach(section => observer.observe(section));
  }

  supabase.auth.onAuthStateChange((event, session) => {
    updateUIForAuthState(session?.user);
    // Reload gallery on auth change to show/hide delete buttons
    loadGallery();
  });
  init();
});
