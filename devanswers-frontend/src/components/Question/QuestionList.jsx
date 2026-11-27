import { useState } from 'react';
import { Pagination } from 'react-bootstrap';
import QuestionCard from './QuestionCard.jsx';
import QuestionFilterBar, { SORT_OPTIONS } from './QuestionFilterBar.jsx';
import './QuestionList.css';

const QUESTIONS_PER_PAGE = 5;

const DEFAULT_EMPTY_TITLE = 'No questions found';
const DEFAULT_EMPTY_HINT = 'Try adjusting your search or be the first to ask!';

const QuestionList = ({
    questions = [],
    sortOptions = SORT_OPTIONS,
    defaultSort = 'newest',
    emptyTitle = DEFAULT_EMPTY_TITLE,
    emptyHint = DEFAULT_EMPTY_HINT,
}) => {
    const [page, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState(defaultSort);

    const filtered = questions.filter((q) =>
        q.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        q.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const sorted = [...filtered].sort((a, b) => {
        switch (sortBy) {
            case 'saved':
                return new Date(b.bookmarkedAt) - new Date(a.bookmarkedAt);
            case 'votes':
                return (b.voteCount || 0) - (a.voteCount || 0);
            case 'answers': {
                const aCount = a.answerCount ?? (Array.isArray(a.answers) ? a.answers.length : 0);
                const bCount = b.answerCount ?? (Array.isArray(b.answers) ? b.answers.length : 0);
                return bCount - aCount;
            }
            default:
                return new Date(b.createdAt) - new Date(a.createdAt);
        }
    });

    const totalPages = Math.ceil(sorted.length / QUESTIONS_PER_PAGE);
    // Clamp so removing items (e.g. unbookmarking) never strands the user on an empty page
    const currentPage = Math.min(page, Math.max(totalPages, 1));
    const start = (currentPage - 1) * QUESTIONS_PER_PAGE;
    const currentQuestions = sorted.slice(start, start + QUESTIONS_PER_PAGE);

    const handlePageChange = (page) => {
        setCurrentPage(page);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSearch = (value) => {
        setSearchQuery(value);
        setCurrentPage(1);
    };

    const handleSort = (value) => {
        setSortBy(value);
        setCurrentPage(1);
    };

    return (
        <div>
            {/* Search and Sort Bar */}
            <QuestionFilterBar
                searchQuery={searchQuery}
                onSearch={handleSearch}
                sortBy={sortBy}
                onSort={handleSort}
                options={sortOptions}
            />

            {/* Question Count */}
            <p className="qlist-count mb-3">
                {sorted.length} {sorted.length === 1 ? 'question' : 'questions'}
            </p>

            {/* Questions */}
            <div className="qlist-container">
                {currentQuestions.length > 0 ? (
                    currentQuestions.map((question) => (
                        <QuestionCard key={question._id} question={question} />
                    ))
                ) : (
                    <div className="text-center py-5">
                        {/* Custom empty text only when there is nothing at all; a search miss keeps the default text */}
                        <h4 className="text-muted">
                            {questions.length === 0 ? emptyTitle : DEFAULT_EMPTY_TITLE}
                        </h4>
                        <p className="text-muted">
                            {questions.length === 0 ? emptyHint : DEFAULT_EMPTY_HINT}
                        </p>
                    </div>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="d-flex justify-content-center mt-4">
                    <Pagination>
                        <Pagination.First onClick={() => handlePageChange(1)} disabled={currentPage === 1} />
                        <Pagination.Prev onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} />

                        {[...Array(totalPages)].map((_, i) => {
                            const page = i + 1;
                            if (
                                page === 1 ||
                                page === totalPages ||
                                (page >= currentPage - 1 && page <= currentPage + 1)
                            ) {
                                return (
                                    <Pagination.Item
                                        key={page}
                                        active={page === currentPage}
                                        onClick={() => handlePageChange(page)}
                                    >
                                        {page}
                                    </Pagination.Item>
                                );
                            }
                            if (page === currentPage - 2 || page === currentPage + 2) {
                                return <Pagination.Ellipsis key={page} disabled />;
                            }
                            return null;
                        })}

                        <Pagination.Next onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} />
                        <Pagination.Last onClick={() => handlePageChange(totalPages)} disabled={currentPage === totalPages} />
                    </Pagination>
                </div>
            )}
        </div>
    );
};

export default QuestionList;
