import React from 'react';
import Map, { Marker } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../styles/MapView.scss';
import { RestaurantDetails } from '../types/map';

interface MapViewProps {
  viewState: {
    longitude: number;
    latitude: number;
    zoom: number;
  };
  onMove: (evt: any) => void;
  isDarkMode: boolean;
  mapboxAccessToken: string;
  places?: RestaurantDetails[];
}

const MapView: React.FC<MapViewProps> = ({ viewState, onMove, isDarkMode, mapboxAccessToken, places }) => {
  return (
    <div className="map-view">
      <Map
        {...viewState}
        onMove={onMove}
        mapStyle={isDarkMode ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/streets-v9"}
        mapboxAccessToken={mapboxAccessToken}
      >
        {Array.isArray(places) && places.map((place) => (
          <Marker
            key={place.id}
            longitude={place.location.longitude}
            latitude={place.location.latitude}
          >
            <img
              src="/icons/i-food.svg"
              alt="Food Marker"
              title={place.displayName?.text || ''}
              style={{ width: 32, height: 32, cursor: 'cursor' }}
            />
          </Marker>
        ))}
      </Map>
    </div>
  );
};

export default MapView;