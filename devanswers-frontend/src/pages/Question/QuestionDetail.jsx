import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Container, Row, Col, Spinner } from 'react-bootstrap';
import { useSelector, useDispatch } from 'react-redux';

import { fetchQuestionById } from '../../reducers/questionSlice.js';
import QuestionContent from '../../components/Question/QuestionContent.jsx';
import AnswerList from '../../components/Answer/AnswerList.jsx';
import AnswerForm from '../../components/Answer/AnswerForm.jsx';
import './QuestionDetail.css';

const QuestionDetail = () => {
  const { id } = useParams();

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { currentQuestion, loading, error } = useSelector((state) => state.question);

  // Read through refs so the fetch effect runs only when the ID changes,
  // not on every store update or when the fromEdit flag is cleared below.
  const currentIdRef = useRef(currentQuestion?._id);
  currentIdRef.current = currentQuestion?._id;
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    const { state, pathname } = locationRef.current;
    // Coming back from a successful edit: the store already holds the saved
    // question, so skip the refetch (it would flash a spinner and count a view).
    if (state?.fromEdit && currentIdRef.current === id) {
      navigate(pathname, { replace: true, state: null });
      return;
    }
    dispatch(fetchQuestionById(id));
  }, [id, dispatch, navigate]);

  if (loading) {
    return (
      <Container className="qd-loading-container">
        <Spinner />
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="qd-loading-container">
        <p>Error loading question: {error}</p>
      </Container>
    );
  }

  if (!currentQuestion) {
    return (
      <Container className="qd-loading-container">
        <p>Question not found.</p>
      </Container>
    );
  }

  return (
    <Container className="qd-container">
      <Row className="justify-content-center">
        <Col xs={12} lg={10} xl={8}>
          <QuestionContent
            question={currentQuestion}
          />
          
          <AnswerList
            answers={currentQuestion.answers}
            question={currentQuestion}
          />
          
          <AnswerForm
            questionId={id}
          />
        </Col>
      </Row>
    </Container>
  );
};

export default QuestionDetail;