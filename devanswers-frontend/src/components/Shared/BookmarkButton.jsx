import { Button } from 'react-bootstrap';
import { FaBookmark, FaRegBookmark } from 'react-icons/fa';
import { useDispatch, useSelector } from 'react-redux';
import {
  addBookmark,
  removeBookmark,
  selectIsBookmarked,
  selectIsBookmarkPending,
} from '../../reducers/bookmarkSlice';
import './BookmarkButton.css';

/**
 * Bookmark toggle used by QuestionCard and QuestionContent.
 * Handles the auth guard internally, like VoteButtons. State is optimistic:
 * the icon flips immediately and reverts if the request fails.
 */
const BookmarkButton = ({ question, className = '', size, variant = 'link' }) => {
  const dispatch = useDispatch();
  const isAuthenticated = useSelector((state) => !!state.user?.userInfo);
  const questionId = question?._id;
  const isBookmarked = useSelector((state) => selectIsBookmarked(state, questionId));
  const isPending = useSelector((state) => selectIsBookmarkPending(state, questionId));

  if (!questionId) {
    return null;
  }

  const label = isBookmarked ? 'Remove bookmark' : 'Bookmark question';

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isAuthenticated) {
      alert('You must be logged in to bookmark a question.');
      return;
    }

    if (isPending) return;

    const action = isBookmarked ? removeBookmark(questionId) : addBookmark(question);
    try {
      await dispatch(action).unwrap();
    } catch (error) {
      // A skipped duplicate toggle isn't a failure
      if (error?.name === 'ConditionError') return;
      alert(typeof error === 'string' ? error : 'Failed to update bookmark');
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={`bookmark-btn ${isBookmarked ? 'bookmark-btn-active' : ''} ${className}`.trim()}
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={isBookmarked}
      aria-label={label}
      title={label}
    >
      {isBookmarked ? (
        <FaBookmark data-testid="bookmark-icon-filled" />
      ) : (
        <FaRegBookmark data-testid="bookmark-icon-outline" />
      )}
    </Button>
  );
};

export default BookmarkButton;
