import { assignmentHandlers } from '@/lib/classrooms/assignment-routes';
export const runtime = 'nodejs';
export const GET = assignmentHandlers().TASK;
export const POST = assignmentHandlers().WRITE;

