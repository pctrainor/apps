import React from 'react';
import '../styles/MapControls.scss';

interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onLocate: () => void;
  onFullscreen: () => void;
  onReset: () => void;
}

const MapControls: React.FC<MapControlsProps> = ({
  onZoomIn,
  onZoomOut,
  onLocate,
  onFullscreen,
  onReset
}) => {
  return (
    <div className="map-controls">
      <button className="map-control-btn" onClick={onZoomIn} title="Zoom In">
        <img src="/icons/i-zoom-in.svg" alt="Zoom In" />
      </button>
      <button className="map-control-btn" onClick={onZoomOut} title="Zoom Out">
        <img src="/icons/i-zoom-out.svg" alt="Zoom Out" />
      </button>
      <div className="map-control-separator"></div>
      <button className="map-control-btn" onClick={onLocate} title="Locate Me">
        <img src="/icons/i-locate.svg" alt="Locate Me" />
      </button>
      <button className="map-control-btn" onClick={onFullscreen} title="Toggle Fullscreen">
        <img src="/icons/i-fullscreen.svg" alt="Fullscreen" />
      </button>
      <button className="map-control-btn" onClick={onReset} title="Reset View">
        <img src="/icons/i-home.svg" alt="Reset View" />
      </button>
    </div>
  );
};

export default MapControls;