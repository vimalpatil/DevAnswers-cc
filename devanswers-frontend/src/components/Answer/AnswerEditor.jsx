import { useState } from 'react';
import { Form, Button, Alert } from 'react-bootstrap';
import { useDispatch } from 'react-redux';
import { Link } from 'react-router-dom';
import { editAnswer, SESSION_EXPIRED_MESSAGE } from '../../reducers/questionSlice';
import { validateAnswerText } from '../../utils/postValidation';

/**
 * Inline editor for one answer (spec 002, AC-11–14). Mounted only while that
 * answer is in edit mode, so cancelling simply unmounts it and drops the draft.
 * Saves are pessimistic: the store changes only after the server confirms.
 */
const AnswerEditor = ({ answer, onDone }) => {
  const dispatch = useDispatch();
  const [draft, setDraft] = useState(answer.answerText ?? '');
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState(null);
  const [serverError, setServerError] = useState(null);

  const handleSave = async () => {
    if (saving) return;

    const error = validateAnswerText(draft);
    if (error) {
      setFieldError(error);
      return;
    }

    setFieldError(null);
    setServerError(null);
    setSaving(true);
    try {
      await dispatch(editAnswer({ answerId: answer._id, answerText: draft })).unwrap();
      onDone();
    } catch (err) {
      setServerError(typeof err === 'string' ? err : 'Failed to update answer');
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && !saving) onDone();
  };

  const inputId = `answer-edit-${answer._id}`;

  return (
    <div className="mb-2 alist-editor">
      <Form.Label htmlFor={inputId} className="visually-hidden">
        Edit answer
      </Form.Label>
      <Form.Control
        as="textarea"
        id={inputId}
        rows={5}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (fieldError) setFieldError(null);
        }}
        onKeyDown={handleKeyDown}
        readOnly={saving}
        isInvalid={!!fieldError}
        autoFocus
        className="alist-editor-input"
      />
      <Form.Control.Feedback type="invalid">{fieldError}</Form.Control.Feedback>

      {serverError && (
        <Alert variant="danger" className="mt-2 mb-0 py-2 small">
          {serverError}
          {serverError === SESSION_EXPIRED_MESSAGE && (
            <>
              {' '}
              <Link to="/login">Log in</Link>
            </>
          )}
        </Alert>
      )}

      <div className="d-flex gap-2 mt-2">
        <Button size="sm" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="outline-secondary" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default AnswerEditor;
