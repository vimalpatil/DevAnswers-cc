import express from 'express';
import { login, register, getUserStats } from '../controllers/authController.js';


const router = express.Router();
// Route for user registration
router.post('/register', register);
// Route for user login
router.post('/login', login);
// Public route for a user's activity stats (used by the Profile page)
router.get('/stats/:userId', getUserStats);


export default router;