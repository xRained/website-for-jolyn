document.addEventListener('DOMContentLoaded', function() {

  // Use the supabaseClient we defined in index.html
  const supabase = window.supabaseClient;  
  // Critical check to ensure Supabase is initialized
  if (!supabase) {
    console.error("Supabase client is not initialized. Check index.html.");
    alert("A critical error occurred. Please refresh the page.");
    return;
  }

  // --- Element Selectors ---
  const authContainer = document.getElementById('auth-container');
  const userProfileArea = document.getElementById('user-profile-area');
  const addLocationButton = document.getElementById('add-location-button');
  const locationNotice = document.querySelector('.location-notice');
  const iconUploadInput = document.getElementById('icon-upload');
  const uploadButton = document.getElementById('upload-button');
  const galleryUploadButton = document.getElementById('gallery-upload-button');
  const galleryGrid = document.querySelector('.gallery-grid');
  const modal = document.getElementById('upload-modal');
  const notesContainer = document.querySelector('.notes-container');
  const timelineContainer = document.querySelector('.timeline-container');
  const favoritesList = document.querySelector('.favorites-list');
  const openModalButton = document.getElementById('open-upload-modal-button');
  const closeModalButton = document.querySelector('.close-button');
  const galleryFileInput = document.getElementById('gallery-upload-file');
  const imagePreviewContainer = document.getElementById('image-preview-container');
  const imagePreview = document.getElementById('image-preview');
  const imageViewerModal = document.getElementById('image-viewer-modal');
  const fullscreenImage = document.getElementById('fullscreen-image');
  const closeViewerButton = document.querySelector('.close-viewer-button');

  // --- Map Variables ---
  let map = null;
  let userMarkers = {}; // To keep track of markers on the map

  // --- Authentication ---
  supabase.auth.onAuthStateChange(async (event, session) => {
    const user = session?.user;

    if (user) { // User is logged in
      console.log('User signed in:', user.user_metadata.full_name);
      authContainer.innerHTML = `<li><a href="#" id="logout-button">Logout</a></li>`;
      document.getElementById('logout-button').addEventListener('click', async () => {
        if (confirm('Are you sure you want to log out?')) {
          await supabase.auth.signOut();
          location.reload(); // Reload the page to reset state
        }
      });

      // Show user-specific UI
      addLocationButton.style.display = 'block';
      locationNotice.style.display = 'none';

      document.getElementById('user-name').textContent = user.user_metadata.full_name;

      const profile = await getProfile(user.id);
      document.getElementById('user-icon').src = profile?.icon_url || 'https://via.placeholder.com/50';

      initializeMap();
      await loadInitialLocations(); // Load existing locations first
      startLocationSharing(user, profile);
      listenForUserLocations();

    } else { // User is logged out
      console.log('User signed out.');
      authContainer.innerHTML = `<li><a href="#" id="login-button">Login with Google</a></li>`;
      document.getElementById('login-button').addEventListener('click', () => {
        supabase.auth.signInWithOAuth({ provider: 'google' });
      });

      // Hide user-specific UI
      addLocationButton.style.display = 'none';
      locationNotice.style.display = 'block';
      if (map) { map.remove(); map = null; }
    }
  });

  // --- Profile Management ---
  uploadButton.addEventListener('click', async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const file = iconUploadInput.files[0];
    if (!user || !file) return;

    const statusElem = document.getElementById('upload-status');
    statusElem.textContent = 'Uploading...';

    const filePath = `${user.id}/${file.name}`;

    try {
      // Upload file to Supabase Storage
      const { error: uploadError } = await supabase.storage.from('media').upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(filePath);

      // Update profile in the database
      const { error: dbError } = await supabase.from('profiles').upsert({ id: user.id, icon_url: publicUrl, display_name: user.user_metadata.full_name });
      if (dbError) throw dbError;

      // Also update the icon in the locations table so the map marker updates instantly
      await supabase.from('locations').update({ icon_url: publicUrl }).eq('id', user.id);

      document.getElementById('user-icon').src = publicUrl;
      statusElem.textContent = 'Upload complete!';
    } catch (error) {
      console.error("Upload failed:", error);
      statusElem.textContent = 'Upload failed.';
    }
  });

  async function getProfile(userId) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error) console.error('Error fetching profile:', error);
    return data;
  }

  // --- Map and Location Logic ---
  function initializeMap() {
    if (map) return;
    map = L.map('map').setView([51.505, -0.09], 2); // Default view
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  }

  // New function to load existing locations when the map is first initialized
  async function loadInitialLocations() {
    const { data: locations, error } = await supabase.from('locations').select('*');
    if (error) {
      console.error('Error fetching initial locations:', error);
      return;
    }

    locations.forEach(userData => {
      const uid = userData.id;
      const customIcon = L.icon({
        iconUrl: userData.icon_url,
        iconSize: [40, 40],
        iconAnchor: [20, 40],
        popupAnchor: [0, -40]
      });

      const marker = L.marker([userData.lat, userData.lng], { icon: customIcon })
        .addTo(map)
        .bindPopup(`<b>${userData.display_name}</b>`);

      userMarkers[uid] = marker;
    });

    // Center the map after loading the initial markers
    const allMarkers = Object.values(userMarkers);
    if (allMarkers.length > 0) {
      const group = new L.featureGroup(allMarkers);
      map.fitBounds(group.getBounds().pad(0.5));
    }
  }

  // New: Event listener for the "Add Live Location" button
  addLocationButton.addEventListener('click', () => {
    userProfileArea.style.display = 'block'; // Show the upload/sharing area
    addLocationButton.style.display = 'none'; // Hide the button itself
  });

  function startLocationSharing(user, profile) {
    navigator.geolocation.watchPosition(async (position) => {
      const { latitude, longitude } = position.coords;
      console.log('Updating location:', latitude, longitude);
      await supabase.from('locations').upsert({
        id: user.id,
        lat: latitude,
        lng: longitude,
        display_name: user.user_metadata.full_name,
        icon_url: profile?.icon_url || 'https://via.placeholder.com/50',
        updated_at: new Date().toISOString()
      });
    }, error => {
      console.error("Geolocation error:", error);
    }, { enableHighAccuracy: true });
  }

  // Listen for real-time location changes
  function listenForUserLocations() {
    const channel = supabase.channel('locations-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, payload => {
        const userData = payload.new;
        const uid = userData.id;

        // Remove old marker if it exists
        if (userMarkers[uid]) { map.removeLayer(userMarkers[uid]); }

        // Create a custom icon
        const customIcon = L.icon({
          iconUrl: userData.icon_url,
          iconSize: [40, 40],
          iconAnchor: [20, 40],
          popupAnchor: [0, -40]
        });

        // Add new marker
        const marker = L.marker([userData.lat, userData.lng], { icon: customIcon })
          .addTo(map)
          .bindPopup(`<b>${userData.display_name}</b>`);

        userMarkers[uid] = marker;

        // Fit map to show all markers
        const allMarkers = Object.values(userMarkers);
        if (allMarkers.length > 0) {
          const group = new L.featureGroup(allMarkers);
          map.fitBounds(group.getBounds().pad(0.5));
        }
      })
      .subscribe();
    return channel;
  }

  // --- Gallery Logic ---
  async function loadGallery() {
    // Get the current user session to decide if we should show delete buttons
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.from('gallery').select('id, url').order('created_at', { ascending: false });
    if (error) {
      console.error('Error loading gallery:', error);
      return;
    }

    galleryGrid.innerHTML = ''; // Clear existing gallery
    data.forEach(image => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'gallery-item';

      const img = document.createElement('img');
      img.src = image.url;
      img.alt = 'Gallery moment';
      itemDiv.appendChild(img);

      // If a user is logged in, add a delete button to the image
      if (session) {
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-photo-button';
        deleteButton.innerHTML = '&times;'; // A nice 'x' character
        deleteButton.dataset.imageId = image.id;
        itemDiv.appendChild(deleteButton);
      }

      galleryGrid.appendChild(itemDiv);
    });
  }

  // --- Image Viewer Logic ---
  galleryGrid.addEventListener('click', (event) => {
    // Check if an image inside the gallery was clicked (but not the delete button)
    if (event.target.tagName === 'IMG') {
      imageViewerModal.style.display = 'flex'; // Use flex for centering
      fullscreenImage.src = event.target.src;
    }
  });

  function closeImageViewer() {
    imageViewerModal.style.display = 'none';
  }

  closeViewerButton.addEventListener('click', closeImageViewer);
  imageViewerModal.addEventListener('click', (event) => { if (event.target === imageViewerModal) closeImageViewer(); });

  // Add a single event listener to the grid to handle all delete clicks
  galleryGrid.addEventListener('click', async (event) => {
    if (event.target.classList.contains('delete-photo-button')) {
      const imageId = event.target.getAttribute('data-image-id');
      if (confirm('Are you sure you want to delete this photo?')) {
        await deletePhoto(imageId);
      }
    }
  });

  async function deletePhoto(imageId) {
    try {
      // Critical safety check: Do not proceed if the imageId is missing.
      if (!imageId) {
        throw new Error("Image ID is missing. Deletion aborted for safety.");
      }

      // 1. Get image URL from DB to find the file path
      const { data: image, error: fetchError } = await supabase.from('gallery').select('url').eq('id', imageId).single();
      if (fetchError) throw fetchError;

      const filePath = new URL(image.url).pathname.split(`/media/`)[1];

      // 2. Delete from the 'gallery' database table first
      const { error: dbError } = await supabase.from('gallery').delete().eq('id', imageId);
      if (dbError) throw dbError;

      // 3. Delete from Supabase Storage
      const { error: storageError } = await supabase.storage.from('media').remove([filePath]);
      if (storageError) throw storageError;

      console.log('Photo deleted successfully');
      loadGallery(); // Refresh the gallery to show the change
    } catch (error) {
      console.error('Error deleting photo:', error);
      alert('There was an error deleting the photo.');
    }
  }

  // --- Modal Logic ---
  openModalButton.addEventListener('click', () => {
    modal.style.display = 'block';
  });

  closeModalButton.addEventListener('click', () => {
    modal.style.display = 'none';
    imagePreviewContainer.style.display = 'none'; // Hide preview on close
    galleryFileInput.value = ''; // Reset file input
  });

  window.addEventListener('click', (event) => {
    if (event.target == modal) {
      modal.style.display = 'none';
      imagePreviewContainer.style.display = 'none';
      galleryFileInput.value = '';
    }
  });

  galleryFileInput.addEventListener('change', function() {
    const file = this.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        imagePreview.setAttribute('src', e.target.result);
        imagePreviewContainer.style.display = 'block';
      }
      reader.readAsDataURL(file);
    }
  });

  galleryUploadButton.addEventListener('click', async () => {
    const file = galleryFileInput.files[0];
    if (!file) {
      alert('Please select an image to upload.');
      return;
    }

    galleryUploadButton.textContent = 'Uploading...';
    galleryUploadButton.disabled = true;

    const filePath = `gallery/${Date.now()}-${file.name}`;

    try {
      const { error: uploadError } = await supabase.storage.from('media').upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(filePath);

      const { error: dbError } = await supabase.from('gallery').insert({ url: publicUrl }).select();
      if (dbError) throw dbError;

      alert('Photo uploaded successfully!');
      galleryFileInput.value = ''; // Clear the file input
      modal.style.display = 'none'; // Close the modal
      imagePreviewContainer.style.display = 'none'; // Hide preview
      loadGallery(); // Refresh the gallery
    } catch (error) {
      console.error("Error uploading to gallery: ", error);
      alert('Sorry, there was an error uploading your photo.');
    } finally {
      // Restore the button state
      galleryUploadButton.textContent = 'Upload Photo';
      galleryUploadButton.disabled = false;
    }
  });

  // --- Content Loading ---
  async function loadNotes() {
    const { data, error } = await supabase.from('notes').select('content').order('created_at', { ascending: false });
    if (error) {
      console.error('Error loading notes:', error);
      return;
    }
    notesContainer.innerHTML = data.map(note => `<div class="note-card"><h3>A Note</h3><p>${note.content}</p></div>`).join('');
  }

  async function loadTimeline() {
    const { data, error } = await supabase.from('timeline').select('*').order('event_date', { ascending: true });
    if (error) {
      console.error('Error loading timeline:', error);
      return;
    }
    timelineContainer.innerHTML = data.map(event => `
      <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-date">${new Date(event.event_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
          <h3>${event.title}</h3>
          <p>${event.description}</p>
        </div>
      </div>
    `).join('');
  }

  async function loadFavorites() {
    const { data, error } = await supabase.from('favorites').select('item');
    if (error) {
      console.error('Error loading favorites:', error);
      return;
    }
    favoritesList.innerHTML = data.map(fav => `<li><span class="heart-icon">♥</span>${fav.item}</li>`).join('');
  }

  // --- Wait for the entire page to load before running animations and content loading ---
  // --- Initial Data Load ---
  function loadAllContent() {
    loadGallery();
    loadNotes();
    loadTimeline();
    loadFavorites();
  }
  loadAllContent();

  // --- Smooth Scroll Animation ---
  // This makes the sections visible as you scroll down the page.
  const sections = document.querySelectorAll('.content-section');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1 // The section becomes visible when 10% is in view
  });

  sections.forEach(section => observer.observe(section));
});
