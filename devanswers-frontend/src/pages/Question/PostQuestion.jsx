import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { FaPaperPlane, FaCheck, FaTimes, FaSave } from 'react-icons/fa';

import {
  postQuestion,
  editQuestion,
  fetchQuestionById,
  SESSION_EXPIRED_MESSAGE,
} from '../../reducers/questionSlice.js';
import { improveQuestion } from '../../services/aiService.js';
import { validateQuestionForm } from '../../utils/postValidation.js';

import { Alert, Col, Container, Form, Button, Card, Row, Spinner } from 'react-bootstrap';
import './PostQuestion.css';

const AISuggestion = ({ text, onAccept, onReject }) => (
  <div className="pq-ai-bubble">
    <span className="pq-ai-bubble-label">AI suggestion</span>
    <p className="pq-ai-bubble-text">{text}</p>
    <div className="pq-ai-bubble-actions">
      <button type="button" className="pq-ai-btn pq-ai-btn--accept" onClick={onAccept} title="Accept">
        <FaCheck />
      </button>
      <button type="button" className="pq-ai-btn pq-ai-btn--reject" onClick={onReject} title="Reject">
        <FaTimes />
      </button>
    </div>
  </div>
);

const PageShell = ({ children }) => (
  <Container className="py-3 px-2 py-sm-4 px-sm-3 pq-page-container">
    <Row className="justify-content-center">
      <Col xs={12} lg={10} xl={9}>{children}</Col>
    </Row>
  </Container>
);

/**
 * Ask a question (`mode="create"`, the default, at /ask) or edit one
 * (`mode="edit"`, at /question/:id/edit — spec 002). Create mode keeps its
 * original behaviour; edit mode adds pre-fill, guards, inline validation,
 * a pessimistic saving state and Cancel.
 */
const PostQuestion = ({ mode = 'create' }) => {
  const isEdit = mode === 'edit';
  const { id } = useParams();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');

  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [dismissed, setDismissed] = useState({ title: false, description: false, tags: false });

  // Edit-mode state
  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const prefilledRef = useRef(false);
  const savingRef = useRef(false);

  const navigate = useNavigate();
  const dispatch = useDispatch();
  const userInfo = useSelector((state) => state.user.userInfo);
  const currentQuestion = useSelector((state) => state.question.currentQuestion);

  const isLoggedIn = !!userInfo;
  const questionLoaded = isEdit && currentQuestion?._id === id;
  const isAuthor = questionLoaded && isLoggedIn && currentQuestion.author?._id === userInfo.userId;

  // A different :id means a different question to pre-fill.
  useEffect(() => {
    prefilledRef.current = false;
  }, [id]);

  // Edit mode: load the question unless the store already holds it.
  useEffect(() => {
    if (!isEdit || !isLoggedIn || currentQuestion?._id === id) return;
    setFetchFailed(false);
    dispatch(fetchQuestionById(id))
      .unwrap()
      .catch(() => setFetchFailed(true));
    // Only fetch when the route ID changes, not on every store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, id, dispatch, isLoggedIn]);

  // Edit mode: pre-fill once, so later store updates never overwrite typing.
  useEffect(() => {
    if (!questionLoaded || prefilledRef.current) return;
    prefilledRef.current = true;
    setTitle(currentQuestion.title ?? '');
    setDescription(currentQuestion.description ?? '');
    setTags((currentQuestion.tags ?? []).map((t) => t.name).join(', '));
  }, [questionLoaded, currentQuestion]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const result = await dispatch(postQuestion({ title, description, tags }));
      if (postQuestion.fulfilled.match(result)) {
        alert('Question posted successfully!');
        navigate(`/question/${result.payload._id}`);
      }
    } catch (error) {
      console.error('Error posting question:', error);
      alert('Failed to post question. Please try again.');
    }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;

    const errors = validateQuestionForm({ title, description, tags });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    savingRef.current = true;
    setSaving(true);
    setServerError(null);
    try {
      await dispatch(editQuestion({ id, title, description, tags })).unwrap();
      navigate(`/question/${id}`, { state: { fromEdit: true } });
    } catch (err) {
      setServerError(typeof err === 'string' ? err : 'Failed to update question');
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (savingRef.current) return;
    navigate(`/question/${id}`);
  };

  const handleFormKeyDown = (e) => {
    if (isEdit && e.key === 'Escape') handleCancel();
  };

  const clearFieldError = (field) => {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleImprove = async () => {
    setAiLoading(true);
    setAiSuggestions(null);
    try {
      const data = await improveQuestion(title, description, tags, userInfo?.token);
      setAiSuggestions(data);
      setDismissed({ title: false, description: false, tags: false });
    } catch (err) {
      alert('AI improvement failed. Please try again.');
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  };

  const accept = (field) => {
    if (field === 'title') setTitle(aiSuggestions.improved_title);
    if (field === 'description') setDescription(aiSuggestions.improved_description);
    if (field === 'tags') setTags(
      Array.isArray(aiSuggestions.improved_tags)
        ? aiSuggestions.improved_tags.join(', ')
        : aiSuggestions.improved_tags
    );
    setDismissed((prev) => ({ ...prev, [field]: true }));
  };

  const reject = (field) => {
    setDismissed((prev) => ({ ...prev, [field]: true }));
  };

  // ── Edit-mode guards (AC-9) ────────────────────────────────────────────────
  if (isEdit) {
    if (!userInfo) {
      return <Navigate to="/login" replace />;
    }
    if (!questionLoaded) {
      return (
        <PageShell>
          {fetchFailed ? (
            <Alert variant="warning" className="mt-3">
              Question not found. <Link to="/">Back to questions</Link>
            </Alert>
          ) : (
            <div className="text-center py-5">
              <Spinner role="status" aria-label="Loading question" />
            </div>
          )}
        </PageShell>
      );
    }
    if (!isAuthor) {
      return (
        <PageShell>
          <Alert variant="warning" className="mt-3">
            You can only edit your own questions.{' '}
            <Link to={`/question/${id}`}>Back to the question</Link>
          </Alert>
        </PageShell>
      );
    }
  }

  const showTitleSuggestion  = aiSuggestions && !dismissed.title;
  const showBodySuggestion   = aiSuggestions && !dismissed.description;
  const showTagsSuggestion   = aiSuggestions && !dismissed.tags;

  const canImprove = title.trim() && description.trim() && !aiLoading && !saving;

  const serverErrorContent =
    serverError === 'Question not found' ? (
      <>This question no longer exists. <Link to="/">Back to questions</Link></>
    ) : serverError === SESSION_EXPIRED_MESSAGE ? (
      <>{serverError} <Link to="/login">Log in</Link></>
    ) : (
      serverError
    );

  return (
    <PageShell>
      <Card className="mb-4 pq-header-card">
        <Card.Body className="p-3 p-sm-4">
          <Card.Title as="h2" className="pq-title">
            {isEdit ? 'Edit question' : 'Ask a Question'}
          </Card.Title>
          <p className="text-muted mb-0">
            {isEdit
              ? 'Fix mistakes or add details. Answers and votes are kept.'
              : "Be specific and imagine you're asking another person"}
          </p>
        </Card.Body>
      </Card>

      <Card className="pq-body-card">
        <Card.Body className="p-3 p-sm-4">
          {isEdit && serverError && (
            <Alert variant="danger" className="mb-4">
              {serverErrorContent}
            </Alert>
          )}

          <Form
            onSubmit={isEdit ? handleEdit : handleCreate}
            onKeyDown={handleFormKeyDown}
            noValidate={isEdit}
          >

            <Form.Group className={showTitleSuggestion ? 'mb-2' : 'mb-4'}>
              <Form.Label htmlFor="title" className="pq-label">Title</Form.Label>
              <Form.Control
                type="text"
                id="title"
                name="title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  clearFieldError('title');
                }}
                placeholder="What's your programming question?"
                required={!isEdit}
                readOnly={saving}
                isInvalid={!!fieldErrors.title}
                className="pq-input"
              />
              <Form.Control.Feedback type="invalid">{fieldErrors.title}</Form.Control.Feedback>
            </Form.Group>
            {showTitleSuggestion && (
              <AISuggestion
                text={aiSuggestions.improved_title}
                onAccept={() => accept('title')}
                onReject={() => reject('title')}
              />
            )}

            <Form.Group className={showBodySuggestion ? 'mb-2' : 'mb-4'}>
              <Form.Label htmlFor="description" className="pq-label">Description</Form.Label>
              <Form.Control
                as="textarea"
                id="description"
                name="description"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  clearFieldError('description');
                }}
                placeholder="Provide more details about your question..."
                rows={10}
                required={!isEdit}
                readOnly={saving}
                isInvalid={!!fieldErrors.description}
                className="pq-textarea"
              />
              <Form.Control.Feedback type="invalid">{fieldErrors.description}</Form.Control.Feedback>
            </Form.Group>
            {showBodySuggestion && (
              <AISuggestion
                text={aiSuggestions.improved_description}
                onAccept={() => accept('description')}
                onReject={() => reject('description')}
              />
            )}

            <Form.Group className={showTagsSuggestion ? 'mb-2' : 'mb-4'}>
              <Form.Label htmlFor="tags" className="pq-label">Tags (comma-separated)</Form.Label>
              <Form.Control
                type="text"
                id="tags"
                name="tags"
                value={tags}
                onChange={(e) => {
                  setTags(e.target.value);
                  clearFieldError('tags');
                }}
                placeholder="e.g., javascript, react, css"
                readOnly={saving}
                isInvalid={!!fieldErrors.tags}
                className="pq-input"
              />
              <Form.Control.Feedback type="invalid">{fieldErrors.tags}</Form.Control.Feedback>
              {!showTagsSuggestion && (
                <Form.Text className="text-muted">
                  Add up to 5 tags to describe what your question is about
                </Form.Text>
              )}
            </Form.Group>
            {showTagsSuggestion && (
              <AISuggestion
                text={
                  Array.isArray(aiSuggestions.improved_tags)
                    ? aiSuggestions.improved_tags.join(', ')
                    : aiSuggestions.improved_tags
                }
                onAccept={() => accept('tags')}
                onReject={() => reject('tags')}
              />
            )}

            <Button
              type="button"
              variant="outline-secondary"
              className="w-100 mb-3 pq-improve-btn"
              onClick={handleImprove}
              disabled={!canImprove}
            >
              {aiLoading ? 'Improving...' : 'Improve with AI'}
            </Button>

            {isEdit ? (
              <div className="d-flex flex-column flex-sm-row gap-2 pq-edit-actions">
                <Button
                  type="button"
                  variant="outline-secondary"
                  size="lg"
                  className="pq-cancel-btn"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="flex-grow-1 pq-btn"
                  disabled={saving}
                >
                  <FaSave className="me-2" />
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            ) : (
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-100 pq-btn"
              >
                <FaPaperPlane className="me-2" />
                Post Question
              </Button>
            )}

          </Form>
        </Card.Body>
      </Card>
    </PageShell>
  );
};

export default PostQuestion;
