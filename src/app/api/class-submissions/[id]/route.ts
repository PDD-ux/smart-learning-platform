import { assignmentHandlers } from '@/lib/classrooms/assignment-routes';
export const runtime = 'nodejs';
export const GET = assignmentHandlers().SUBMISSION;
export const POST = assignmentHandlers().REVIEW;

