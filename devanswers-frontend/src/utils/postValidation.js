// Client-side checks for editing posts. They mirror the server rules in
// devanswers-backend (spec 002 §5) so errors can be shown inline; the server
// stays authoritative.

export const MAX_TITLE_LENGTH = 200;
export const MAX_BODY_LENGTH = 10000;
export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 30;

// Trims, drops blanks and de-dupes case-insensitively (keeping the first spelling).
export const parseTagInput = (input = '') => {
  const seen = new Set();
  const names = [];
  input.split(',').forEach((entry) => {
    const name = entry.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  });
  return names;
};

export const validateTags = (input) => {
  const names = parseTagInput(input);
  if (names.length < 1 || names.length > MAX_TAGS) {
    return `Provide between 1 and ${MAX_TAGS} tags`;
  }
  if (names.some((name) => name.length > MAX_TAG_LENGTH)) {
    return `Each tag must be at most ${MAX_TAG_LENGTH} characters`;
  }
  return null;
};

// Returns a map of field → message; an empty object means the form is valid.
export const validateQuestionForm = ({ title = '', description = '', tags = '' }) => {
  const errors = {};

  if (!title.trim()) {
    errors.title = 'Title is required';
  } else if (title.trim().length > MAX_TITLE_LENGTH) {
    errors.title = `Title must be at most ${MAX_TITLE_LENGTH} characters`;
  }

  if (!description.trim()) {
    errors.description = 'Description is required';
  } else if (description.trim().length > MAX_BODY_LENGTH) {
    errors.description = `Description must be at most ${MAX_BODY_LENGTH} characters`;
  }

  const tagError = validateTags(tags);
  if (tagError) errors.tags = tagError;

  return errors;
};

export const validateAnswerText = (text = '') => {
  if (!text.trim()) return 'Answer text is required';
  if (text.trim().length > MAX_BODY_LENGTH) {
    return `Answer text must be at most ${MAX_BODY_LENGTH} characters`;
  }
  return null;
};
