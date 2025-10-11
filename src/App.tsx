import { useState, useEffect, useRef } from 'react';
import MapView from './components/MapView';
import MapControls from './components/MapControls';
import ThemeToggle from './components/ThemeToggle';
import PlaceModal from './components/PlaceModal';
import { PlaceDetails, Review } from './types/map';
import './styles/App.scss';
import './styles/main-grid.scss';

function App() {
  const [viewState, setViewState] = useState({
    longitude: -122.4,
    latitude: 37.8,
    zoom: 14
  });
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isToggleVisible, setIsToggleVisible] = useState(true);
  const [places, setPlaces] = useState<PlaceDetails[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);
  const [modalPlace, setModalPlace] = useState<PlaceDetails | null>(null);
  const [placeReviews, setPlaceReviews] = useState<Review[]>([]);
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const timeoutRef = useRef<number | null>(null);

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
            fetchNearbyPlaces(userLocation.latitude, userLocation.longitude);
          },
          (error) => {
            console.error('Error getting location:', error);
            fetchNearbyPlaces(viewState.latitude, viewState.longitude);
          }
        );
      } else {
        fetchNearbyPlaces(viewState.latitude, viewState.longitude);
      }
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
      const defaultQuery = 'restaurants, cafes, shops, attractions near me';
      const body = {
        textQuery: defaultQuery,
        locationBias: {
          circle: {
            center: { latitude, longitude },
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
        setPlaces((data.places || []).filter((place: any) => place.location && place.displayName));
      } catch (error) {
        console.error('Failed to fetch nearby places:', error);
        setPlaces([]);
      }
    };

    const handleMarkerHover = (place: PlaceDetails | null) => {
      setSelectedPlace(place);
    };

    const handleMarkerClick = async (place: PlaceDetails) => {
      setModalPlace(place);
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
      timeoutRef.current = window.setTimeout(() => {
        setIsToggleVisible(false);
      }, 3000);
    };

    useEffect(() => {
      resetFadeTimer();
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
      <main className="main-grid">
        <section className="map-section">
          <MapView
            viewState={viewState}
            onMove={evt => setViewState(evt.viewState)}
            isDarkMode={isDarkMode}
            mapboxAccessToken={import.meta.env.VITE_MAPBOX_ACCESS_TOKEN}
            places={places}
            onMarkerHover={handleMarkerHover}
            onMarkerClick={handleMarkerClick}
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
          <div className={`theme-toggle-container ${!isToggleVisible ? 'hidden' : ''}`}>
            <ThemeToggle
              isDarkMode={isDarkMode}
              onToggle={toggleDarkMode}
            />
          </div>
        </section>
        <section className="list-section">
          <div className="list-placeholder">Other content or lists go here</div>
        </section>
        <PlaceModal
          place={modalPlace}
          reviews={placeReviews}
          onClose={handleCloseModal}
        />
      </main>
  );
}
export default App;
