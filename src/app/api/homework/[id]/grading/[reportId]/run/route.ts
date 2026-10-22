import { homeworkGradingHandlers } from '@/lib/homework/grading-routes';
export const runtime = 'nodejs';
const handlers = homeworkGradingHandlers();
export const POST = handlers.RUN;
