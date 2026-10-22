import { classHandlers } from '@/lib/classrooms/routes';
export const runtime = 'nodejs';
export const GET = classHandlers().READ;
export const POST = classHandlers().COMMAND;
