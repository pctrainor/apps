import React from 'react';
import '../styles/PlaceModal.scss';
import { PlaceDetails } from '../types/map';

interface Review {
  author_name: string;
  rating: number;
  text: string | { text: string; languageCode: string };
  time: number;
  relative_time_description: string;
}

interface PlaceModalProps {
  place: PlaceDetails | null;
  reviews: Review[];
  onClose: () => void;
}

const PlaceModal: React.FC<PlaceModalProps> = ({ place, reviews, onClose }) => {
  if (!place) return null;

  const getReviewText = (text: string | { text: string; languageCode: string }) => {
    return typeof text === 'string' ? text : text.text;
  };

  return (
    <div className="place-modal-overlay" onClick={onClose}>
      <div className="place-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}>×</button>
        
        <div className="modal-header">
          <h2>{place.displayName?.text}</h2>
          {place.rating && (
            <div className="modal-rating">⭐ {place.rating}</div>
          )}
          {place.formattedAddress && (
            <p className="modal-address">{place.formattedAddress}</p>
          )}
        </div>

        <div className="modal-body">
          <h3>Recent Reviews</h3>
          {reviews.length > 0 ? (
            <div className="reviews-list">
              {reviews.map((review, index) => (
                <div key={index} className="review-item">
                  <div className="review-header">
                    <span className="review-author">{review.author_name}</span>
                    <span className="review-rating">
                      {'⭐'.repeat(review.rating)}
                    </span>
                  </div>
                  <p className="review-time">{review.relative_time_description}</p>
                  <p className="review-text">{getReviewText(review.text)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-reviews">No reviews available</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlaceModal;
