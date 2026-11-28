import { formatDate } from '../../utils/timeFormat';

// Shows "edited {date}" for a post whose editedAt is set (spec 002, AC-15/16).
// Renders nothing for a post that has never been edited.
const EditedIndicator = ({ editedAt, className = '' }) => {
  if (!editedAt) return null;

  return (
    <span
      className={`text-muted small fst-italic ${className}`.trim()}
      title={new Date(editedAt).toLocaleString()}
    >
      edited {formatDate(editedAt)}
    </span>
  );
};

export default EditedIndicator;
