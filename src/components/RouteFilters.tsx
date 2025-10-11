import React from 'react';
import '../styles/RouteFilters.scss';

interface RouteFiltersProps {
  routeTypeFilters: {
    cycleway: boolean;
    path: boolean;
    track: boolean;
    road: boolean;
  };
  onToggleRouteType: (type: 'cycleway' | 'path' | 'track' | 'road') => void;
  showBikeRoutes: boolean;
  onToggleAllRoutes: () => void;
}

const RouteFilters: React.FC<RouteFiltersProps> = ({
  routeTypeFilters,
  onToggleRouteType,
  showBikeRoutes,
  onToggleAllRoutes
}) => {
  return (
    <div className="route-filters">
      <div className="filter-header">
        <h4>Bike Routes</h4>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={showBikeRoutes}
            onChange={onToggleAllRoutes}
          />
          <span className="slider"></span>
        </label>
      </div>
      
      {showBikeRoutes && (
        <div className="filter-options">
          <label className="filter-option">
            <input
              type="checkbox"
              checked={routeTypeFilters.cycleway}
              onChange={() => onToggleRouteType('cycleway')}
            />
            <span className="filter-color cycleway"></span>
            <span className="filter-label">Bike Paths</span>
          </label>
          
          <label className="filter-option">
            <input
              type="checkbox"
              checked={routeTypeFilters.path}
              onChange={() => onToggleRouteType('path')}
            />
            <span className="filter-color path"></span>
            <span className="filter-label">Trails</span>
          </label>
          
          <label className="filter-option">
            <input
              type="checkbox"
              checked={routeTypeFilters.track}
              onChange={() => onToggleRouteType('track')}
            />
            <span className="filter-color track"></span>
            <span className="filter-label">Tracks</span>
          </label>
          
          <label className="filter-option">
            <input
              type="checkbox"
              checked={routeTypeFilters.road}
              onChange={() => onToggleRouteType('road')}
            />
            <span className="filter-color road"></span>
            <span className="filter-label">Roads</span>
          </label>
        </div>
      )}
    </div>
  );
};

export default RouteFilters;
