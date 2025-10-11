import React from 'react';
import Map, { Marker } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../styles/MapView.scss';
import { PlaceDetails } from '../types/map';

interface MapViewProps {
  viewState: {
    longitude: number;
    latitude: number;
    zoom: number;
  };
  onMove: (evt: any) => void;
  isDarkMode: boolean;
  mapboxAccessToken: string;
  places?: PlaceDetails[];
  onMarkerHover: (place: PlaceDetails | null) => void;
  onMarkerClick: (place: PlaceDetails) => void;
  selectedPlace: PlaceDetails | null;
  onMouseMove: (e: React.MouseEvent) => void;
  cursorPosition: { x: number; y: number };
}

const MapView: React.FC<MapViewProps> = ({
  viewState,
  onMove,
  isDarkMode,
  mapboxAccessToken,
  places,
  onMarkerHover,
  onMarkerClick,
  selectedPlace,
  onMouseMove,
  cursorPosition
}) => {
  return (
    <div className="map-view" onMouseMove={onMouseMove}>
      <Map
        {...viewState}
        onMove={onMove}
        mapStyle={isDarkMode ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/streets-v9"}
        mapboxAccessToken={mapboxAccessToken}
        cursor="default"
      >
        {/* Place Markers */}
        {Array.isArray(places) && places.map((place) => (
          <Marker
            key={place.id}
            longitude={place.location.longitude}
            latitude={place.location.latitude}
          >
            <div 
              onMouseEnter={() => onMarkerHover(place)}
              onMouseLeave={() => onMarkerHover(null)}
              onClick={() => onMarkerClick(place)}
            >
              <img
                src="/icons/i-marker.svg"
                alt="Marker"
                style={{ width: 32, height: 32, cursor: 'default' }}
              />
            </div>
          </Marker>
        ))}
      </Map>
      {selectedPlace && (
        <div 
          className="place-callout"
          style={{
            left: `${cursorPosition.x + 15}px`,
            top: `${cursorPosition.y + 15}px`
          }}
        >
          <div className="callout-content">
            <h3>{selectedPlace.displayName?.text}</h3>
            {selectedPlace.formattedAddress && (
              <p className="address">{selectedPlace.formattedAddress}</p>
            )}
            {selectedPlace.rating && (
              <p className="rating">⭐ {selectedPlace.rating}</p>
            )}
            {selectedPlace.types && selectedPlace.types.length > 0 && (
              <div className="types">
                {selectedPlace.types.slice(0, 3).map((type, index) => (
                  <span key={index} className="type-tag">{type.replace(/_/g, ' ')}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MapView;