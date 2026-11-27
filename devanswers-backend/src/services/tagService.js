import Tag from '../models/Tag.js';
import Question from '../models/Question.js';
import { withAnswerCounts } from './answerCountHelper.js';
import { createAppError } from '../utils/createAppError.js';

export const getAllTagsService = async () => {
    const tags = await Tag.find({});

    const tagsWithCount = await Promise.all(
        tags.map(async (tag) => {
            const questionCount = await Question.countDocuments({ tags: tag._id });
            return { ...tag.toObject(), questionCount };
        })
    );

    return tagsWithCount;
};

export const getQuestionsByTagService = async (tagId) => {
    const tag = await Tag.findById(tagId);
    if (!tag) {
        throw createAppError('Tag not found', 404);
    }

    const questions = await Question.find({ tags: tagId })
        .populate({ path: 'author', select: 'name' })
        .populate('tags')
        // _id breaks ties between questions created in the same millisecond
        .sort({ createdAt: -1, _id: -1 });

    return withAnswerCounts(questions);
};
