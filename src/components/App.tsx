import { useState, useEffect, useRef } from 'react';
import MapView from './components/MapView';
import MapDetails from './components/MapDetails';
import MapControls from './components/MapControls';
import ThemeToggle from './components/ThemeToggle';
import PlaceModal from './components/PlaceModal';
import { PlaceDetails, Review } from './types/map';
import './styles/App.scss';

// Declare global google
declare global {
  interface Window {
    google: any;
  }
}

function App() {
  const [viewState, setViewState] = useState({
    longitude: -122.4,
    latitude: 37.8,
    zoom: 14
  });
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isToggleVisible, setIsToggleVisible] = useState(true);
  const [places, setPlaces] = useState<PlaceDetails[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);
  const [modalPlace, setModalPlace] = useState<PlaceDetails | null>(null);
  const [placeReviews, setPlaceReviews] = useState<Review[]>([]);
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const timeoutRef = useRef<number | null>(null);
  const googleMapsRef = useRef<any>(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userLocation = {
            longitude: position.coords.longitude,
            latitude: position.coords.latitude,
            zoom: 14
          };
          setViewState(userLocation);
          
          // Automatically fetch nearby places after getting user location
          fetchNearbyPlaces(userLocation.latitude, userLocation.longitude);
        },
        (error) => {
          console.error('Error getting location:', error);
          // Fetch places for default location if geolocation fails
          fetchNearbyPlaces(viewState.latitude, viewState.longitude);
        }
      );
    } else {
      // Fetch places for default location if geolocation is not available
      fetchNearbyPlaces(viewState.latitude, viewState.longitude);
    }

    // Initialize Google Maps API
    const initGoogleMaps = () => {
      if (window.google && window.google.maps && window.google.maps.places) {
        googleMapsRef.current = new window.google.maps.places.PlacesService(document.createElement('div'));
      } else {
        // Load Google Maps script
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_API_KEY}&libraries=places`;
        script.async = true;
        script.defer = true;
        script.onload = () => {
          googleMapsRef.current = new window.google.maps.places.PlacesService(document.createElement('div'));
        };
        document.head.appendChild(script);
      }
    };

    initGoogleMaps();
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    resetFadeTimer();
  };

  const handleZoomIn = () => {
    setViewState(prev => ({ ...prev, zoom: Math.min(prev.zoom + 1, 20) }));
  };

  const handleZoomOut = () => {
    setViewState(prev => ({ ...prev, zoom: Math.max(prev.zoom - 1, 1) }));
  };

  const handleLocate = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setViewState({
            longitude: position.coords.longitude,
            latitude: position.coords.latitude,
            zoom: 14
          });
        },
        (error) => {
          console.error('Error getting location:', error);
        }
      );
    }
  };

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const handleReset = () => {
    setViewState({
      longitude: -122.4,
      latitude: 37.8,
      zoom: 14
    });
  };

  const fetchNearbyPlaces = async (latitude: number, longitude: number) => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    const url = 'https://places.googleapis.com/v1/places:searchText';
    
    // Default prompt to find places around the user
    const defaultQuery = 'restaurants, cafes, shops, attractions near me';
    
    const body = {
      textQuery: defaultQuery,
      locationBias: {
        circle: {
          center: { latitude, longitude },
          radius: 5000 // 5km radius around user
        }
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.types'
        },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      // Only keep valid place details
      setPlaces((data.places || []).filter((place: any) => place.location && place.displayName));
    } catch (error) {
      console.error('Failed to fetch nearby places:', error);
      setPlaces([]);
    }
  };

  const searchPlaces = async () => {
    if (!searchQuery.trim()) return;
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    const url = 'https://places.googleapis.com/v1/places:searchText';
    const body = {
      textQuery: searchQuery,
      locationBias: {
        circle: {
          center: { latitude: viewState.latitude, longitude: viewState.longitude },
          radius: 5000
        }
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.types'
        },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      // Only keep valid place details
      setPlaces((data.places || []).filter((place: any) => place.location && place.displayName));
    } catch (error) {
      console.error('Places search failed:', error);
      setPlaces([]);
    }
  };

  const handleMarkerHover = (place: PlaceDetails | null) => {
    setSelectedPlace(place);
  };

  const handleMarkerClick = async (place: PlaceDetails) => {
    setModalPlace(place);
    // Fetch reviews for the place
    await fetchPlaceReviews(place.id);
  };

  const handleCloseModal = () => {
    setModalPlace(null);
    setPlaceReviews([]);
  };

  const fetchPlaceReviews = async (placeId: string) => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    const url = `https://places.googleapis.com/v1/places/${placeId}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'reviews'
        }
      });
      const data = await response.json();
      // Get last 10 reviews
      const reviews = (data.reviews || []).slice(0, 10);
      setPlaceReviews(reviews);
    } catch (error) {
      console.error('Failed to fetch reviews:', error);
      setPlaceReviews([]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setCursorPosition({ x: e.clientX, y: e.clientY });
  };

  const resetFadeTimer = () => {
    setIsToggleVisible(true);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsToggleVisible(false);
    }, 3000); // Fade after 3 seconds
  };

  useEffect(() => {
    // Start the fade timer on mount
    resetFadeTimer();

    // Add event listeners for user activity
    const handleActivity = () => resetFadeTimer();

    document.addEventListener('mousemove', handleActivity);
    document.addEventListener('keydown', handleActivity);
    document.addEventListener('click', handleActivity);
    document.addEventListener('scroll', handleActivity);

    return () => {
      document.removeEventListener('mousemove', handleActivity);
      document.removeEventListener('keydown', handleActivity);
      document.removeEventListener('click', handleActivity);
      document.removeEventListener('scroll', handleActivity);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="app-container">
      <div className="search-bar">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search places..."
          onKeyPress={(e) => e.key === 'Enter' && searchPlaces()}
        />
        <button onClick={searchPlaces}>Search</button>
      </div>
      <MapView
        viewState={viewState}
        onMove={evt => setViewState(evt.viewState)}
        isDarkMode={isDarkMode}
        mapboxAccessToken={import.meta.env.VITE_MAPBOX_ACCESS_TOKEN}
        places={places}
        onMarkerHover={handleMarkerHover}
        selectedPlace={selectedPlace}
        onMouseMove={handleMouseMove}
        cursorPosition={cursorPosition}
      />
      <MapControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onLocate={handleLocate}
        onFullscreen={handleFullscreen}
        onReset={handleReset}
      />
      <MapDetails
        latitude={viewState.latitude}
        longitude={viewState.longitude}
      />
      <div className={`theme-toggle-container ${!isToggleVisible ? 'hidden' : ''}`}>
        <ThemeToggle
          isDarkMode={isDarkMode}
          onToggle={toggleDarkMode}
        />
      </div>
    </div>
  );
}

export default App