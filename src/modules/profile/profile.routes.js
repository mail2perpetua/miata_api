import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import * as ctrl from './profile.controller.js';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.getProfile);
router.patch('/', ctrl.updateProfile);

export default router;
