
export interface MapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
}

export interface PlaceLocation {
  latitude: number;
  longitude: number;
}

export interface PlaceDetails {
  id: string;
  displayName: {
    text: string;
  };
  location: PlaceLocation;
  formattedAddress?: string;
  rating?: number;
  types?: string[];
  reviews?: Review[];
}

export interface Review {
  author_name: string;
  rating: number;
  text: string | { text: string; languageCode: string };
  time: number;
  relative_time_description: string;
}

export interface MarkerProps {
  place: PlaceDetails;
  onClick: (place: PlaceDetails) => void;
}

export interface BikeTrail {
  id: string;
  name: string;
  type: 'cycleway' | 'path' | 'road' | 'track';
  surface?: string;
  geometry: Array<{ lat: number; lon: number }>;
}
